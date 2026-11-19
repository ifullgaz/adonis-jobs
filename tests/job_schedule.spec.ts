import { test } from '@japa/runner'
import { type Assert } from '@japa/assert'
import { DateTime } from 'luxon'
import type JobQueueService from '../src/core/job_queue_service.js'
import { type JobMessage } from '../src/core/job_queue_service.js'
import { JobQueueItemStatus } from '../src/types/types.js'
import { getApp, recordingBus, resetQueue, setBusEnabled } from './helpers/app.js'
import { reloadJob } from './helpers/queue.js'
import SendReport from './helpers/send_report_job.js'

const CHANNEL = 'jobs:job-queue:process'

const busModes = [
  { enabled: false, label: 'disabled' },
  { enabled: true, label: 'enabled' },
] as const

async function captureMessages() {
  const app = getApp()
  const service = (await app.container.make('jobQueueService')) as JobQueueService
  const messages: JobMessage[] = []
  await service.subscribe((message) => {
    messages.push(message)
  })
  return messages
}

function assertDelivery(assert: Assert, messages: JobMessage[], timedValues: Array<number | null>) {
  const expected = timedValues.map((timed) => {
    return { timed }
  })
  assert.deepEqual(messages, expected)
  assert.deepEqual(
    recordingBus.published,
    expected.map((message) => {
      return { channel: CHANNEL, message }
    })
  )
}

async function assertStored(assert: Assert, id: number, reportId: number, when: DateTime | null) {
  const fresh = await reloadJob(id)
  assert.equal(fresh.jobName, 'SendReport')
  assert.deepEqual(fresh.jobParams, { reportId })
  assert.equal(fresh.status, JobQueueItemStatus.New)
  if (when === null) {
    assert.isNull(fresh.dueDate)
    return fresh
  }
  const dueDate = fresh.dueDate
  if (!dueDate) {
    throw new Error('Scheduled job has no due date')
  }
  assert.equal(dueDate.toUnixInteger(), when.toUnixInteger())
  return fresh
}

test.group('Job scheduling', (group) => {
  group.each.setup(async () => {
    await resetQueue()
  })

  for (const busMode of busModes) {
    test(`stores an immediate job when the bus is ${busMode.label}`, async ({ assert }) => {
      setBusEnabled(busMode.enabled)
      const messages = await captureMessages()
      const entry = await SendReport.schedule({ reportId: 1 }, null)

      await assertStored(assert, entry.id, 1, null)
      assertDelivery(assert, messages, busMode.enabled ? [null] : [])
    })

    test(`stores a future job when the bus is ${busMode.label}`, async ({ assert }) => {
      setBusEnabled(busMode.enabled)
      const messages = await captureMessages()
      const when = DateTime.now().plus({ hours: 2 }).startOf('second')
      const entry = await SendReport.schedule({ reportId: 2 }, when)

      await assertStored(assert, entry.id, 2, when)
      assertDelivery(assert, messages, busMode.enabled ? [when.toUnixInteger()] : [])
    })

    test(`stores an already due job when the bus is ${busMode.label}`, async ({ assert }) => {
      setBusEnabled(busMode.enabled)
      const messages = await captureMessages()
      const when = DateTime.now().minus({ minutes: 10 }).startOf('second')
      const entry = await SendReport.schedule({ reportId: 3 }, when)

      await assertStored(assert, entry.id, 3, when)
      assertDelivery(assert, messages, busMode.enabled ? [when.toUnixInteger()] : [])
    })

    test(`stores an immediate job and a timed job when the bus is ${busMode.label}`, async ({
      assert,
    }) => {
      setBusEnabled(busMode.enabled)
      const messages = await captureMessages()
      const when = DateTime.now().plus({ hours: 4 }).startOf('second')
      const immediate = await SendReport.schedule({ reportId: 4 }, null)
      const timed = await SendReport.schedule({ reportId: 5 }, when)

      await assertStored(assert, immediate.id, 4, null)
      await assertStored(assert, timed.id, 5, when)
      assertDelivery(assert, messages, busMode.enabled ? [null, when.toUnixInteger()] : [])
    })
  }
})
