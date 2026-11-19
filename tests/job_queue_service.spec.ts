import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type JobQueueService from '../src/core/job_queue_service.js'
import SendReport from './helpers/send_report_job.js'
import JobQueueEntry from '../src/model/job_queue_entry.js'
import { JobQueueItemStatus } from '../src/types/types.js'
import { getApp, resetQueue } from './helpers/app.js'
import { reloadJob } from './helpers/queue.js'

const IMMUTABLE = /Job queue entries are immutable and cannot be updated/

async function service() {
  const app = getApp()
  return (await app.container.make('jobQueueService')) as JobQueueService
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

test.group('Job queue service', (group) => {
  group.each.setup(async () => {
    await resetQueue()
  })

  test('claims nothing when the matching queue is empty', async ({ assert }) => {
    const queue = await service()
    const when = DateTime.now().plus({ hours: 2 }).startOf('second')
    await SendReport.schedule({ reportId: 1 }, when)

    assert.isUndefined(await queue.pop(false))
    assert.isUndefined(await queue.pop(true))
  })

  test('refuses to reserve an immediate job or an already due job', async ({ assert }) => {
    const queue = await service()
    const immediate = await SendReport.schedule({ reportId: 2 }, null)
    const due = await SendReport.schedule(
      { reportId: 3 },
      DateTime.now().minus({ minutes: 5 }).startOf('second')
    )

    await assert.rejects(() => queue.pop(false), IMMUTABLE)
    await assert.rejects(() => queue.pop(true), IMMUTABLE)
    const storedImmediate = await reloadJob(immediate.id)
    const storedDue = await reloadJob(due.id)
    assert.equal(storedImmediate.status, JobQueueItemStatus.New)
    assert.equal(storedDue.status, JobQueueItemStatus.New)
  })

  test('returns the newest running job and can wait for it to finish', async ({ assert }) => {
    const queue = await service()
    await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 1 },
      status: JobQueueItemStatus.Reserved,
    })
    const latest = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 4, extra: true },
      status: JobQueueItemStatus.Processing,
    })
    await JobQueueEntry.store({
      jobName: 'OtherJob',
      jobParams: { reportId: 4 },
      status: JobQueueItemStatus.Processing,
    })

    const running = await queue.findRunningJob('SendReport')
    assert.equal(running?.id, latest.id)
    assert.isTrue(running?.isRunning)
    assert.isNull(await queue.findRunningJob('SendReport', { reportId: 9 }))
    const matched = await queue.findRunningJob('SendReport', { reportId: 4 })
    assert.equal(matched?.id, latest.id)

    const started = Date.now()
    const pending = queue.findRunningJob('SendReport', undefined, true)
    await sleep(40)
    const database = await getApp().container.make('lucid.db')
    await database
      .from('job_queue')
      .where('id', latest.id)
      .update({ status: JobQueueItemStatus.Completed })
    const finished = await pending

    assert.isAtLeast(Date.now() - started, 80)
    assert.equal(finished?.id, latest.id)
    assert.equal(finished?.status, JobQueueItemStatus.Completed)
    assert.isFalse(finished?.isRunning)
  })

  test('returns the soonest future job and can filter it', async ({ assert }) => {
    const queue = await service()
    const later = DateTime.now().plus({ hours: 5 }).startOf('second')
    const sooner = DateTime.now().plus({ hours: 1 }).startOf('second')
    await SendReport.schedule({ reportId: 1 }, later)
    const next = await SendReport.schedule({ reportId: 8 }, sooner)
    await JobQueueEntry.store({
      jobName: 'OtherJob',
      jobParams: { reportId: 8 },
      dueDate: DateTime.now().plus({ hours: 6 }),
    })
    await SendReport.schedule({ reportId: 8 }, null)

    const scheduled = await queue.findScheduledJob()
    assert.equal(scheduled?.id, next.id)
    const dueDate = scheduled?.dueDate
    if (!dueDate) {
      throw new Error('Scheduled job has no due date')
    }
    assert.equal(dueDate.toUnixInteger(), sooner.toUnixInteger())
    const named = await queue.findScheduledJob('SendReport')
    const filtered = await queue.findScheduledJob('SendReport', { reportId: 8 })
    const laterMatch = await queue.findScheduledJob('SendReport', { reportId: 1 })
    assert.equal(named?.id, next.id)
    assert.equal(filtered?.id, next.id)
    assert.isNotNull(laterMatch)
    assert.notEqual(laterMatch?.id, next.id)
    assert.isNull(await queue.findScheduledJob('SendReport', { reportId: 99 }))
    assert.isNull(await queue.findScheduledJob('Missing'))
  })

  test('rolls back a cancellation that the queue entry refuses to save', async ({ assert }) => {
    const queue = await service()
    const when = DateTime.now().plus({ hours: 3 }).startOf('second')
    const entry = await SendReport.schedule({ reportId: 6 }, when)

    await assert.rejects(
      () => queue.findScheduledJob('SendReport', { reportId: 6 }, { reason: 'replaced' }),
      IMMUTABLE
    )
    const fresh = await reloadJob(entry.id)
    assert.equal(fresh.status, JobQueueItemStatus.New)
    assert.equal(fresh.dueDate?.toUnixInteger(), when.toUnixInteger())
  })

  test('returns the scheduled job when cancellation is accepted', async ({ assert }) => {
    const queue = await service()
    const when = DateTime.now().plus({ hours: 3 }).startOf('second')
    const entry = await SendReport.schedule({ reportId: 16 }, when)
    const original = JobQueueEntry.prototype.cancel
    JobQueueEntry.prototype.cancel = async function acceptCancel() {
      return this
    }
    try {
      const cancelled = await queue.findScheduledJob(
        'SendReport',
        { reportId: 16 },
        { reason: 'replaced' }
      )
      assert.equal(cancelled?.id, entry.id)
    } finally {
      JobQueueEntry.prototype.cancel = original
    }
  })

  test('exposes running and scheduled jobs from the job class', async ({ assert }) => {
    const running = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 7 },
      status: JobQueueItemStatus.Reserved,
    })
    const when = DateTime.now().plus({ hours: 4 }).startOf('second')
    const scheduled = await SendReport.schedule({ reportId: 7 }, when)

    const foundRunning = await SendReport.findRunningJob({ reportId: 7 })
    const foundScheduled = await SendReport.findScheduledJob({ reportId: 7 })
    assert.equal(foundRunning?.id, running.id)
    assert.equal(foundScheduled?.id, scheduled.id)
  })
})
