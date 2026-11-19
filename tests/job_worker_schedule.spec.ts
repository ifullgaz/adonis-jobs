import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import type JobQueueService from '../src/core/job_queue_service.js'
import JobQueueWorker from '../src/core/job_queue_worker.js'
import { JobQueueItemStatus } from '../src/types/types.js'
import { getApp, recordingBus, resetQueue, setBusEnabled } from './helpers/app.js'
import { reloadJob } from './helpers/queue.js'
import SendReport from './helpers/send_report_job.js'

const MAX_WAIT_SECONDS = 20 * 24 * 60 * 60

type WorkerScheduleState = {
  timedQueueDelay: number
  timedQueueTimeout: ReturnType<typeof setTimeout> | null
}

function scheduleState(worker: JobQueueWorker) {
  return worker as unknown as WorkerScheduleState
}

async function withWorker(timed: boolean, run: (worker: JobQueueWorker) => Promise<void>) {
  const worker = new JobQueueWorker(getApp())
  try {
    await worker.start(timed)
    await run(worker)
  } finally {
    await worker.stop()
  }
}

async function withPopCount(run: (calls: boolean[]) => Promise<void>) {
  const app = getApp()
  const service = (await app.container.make('jobQueueService')) as JobQueueService
  const original = service.pop.bind(service)
  const calls: boolean[] = []
  service.pop = async (timed: boolean) => {
    calls.push(timed)
    return original(timed)
  }
  try {
    await run(calls)
  } finally {
    service.pop = original
  }
}

test.group('Job worker scheduling', (group) => {
  group.each.setup(async () => {
    await resetQueue()
  })

  test('stores both kinds of jobs while the timed worker runs without a bus', async ({
    assert,
  }) => {
    setBusEnabled(false)
    const when = DateTime.now().plus({ hours: 4 }).startOf('second')

    await withWorker(true, async (worker) => {
      const immediate = await SendReport.schedule({ reportId: 1 }, null)
      const timed = await SendReport.schedule({ reportId: 2 }, when)
      const state = scheduleState(worker)

      assert.deepEqual(recordingBus.published, [])
      assert.equal(state.timedQueueDelay, 0)
      assert.isNull(state.timedQueueTimeout)

      const storedImmediate = await reloadJob(immediate.id)
      const storedTimed = await reloadJob(timed.id)
      assert.equal(storedImmediate.status, JobQueueItemStatus.New)
      assert.isNull(storedImmediate.dueDate)
      assert.equal(storedTimed.status, JobQueueItemStatus.New)
      assert.equal(storedTimed.dueDate?.toUnixInteger(), when.toUnixInteger())
    })
  })

  test('arms the timed worker from a future job published on the bus', async ({ assert }) => {
    setBusEnabled(true)
    const when = DateTime.now().plus({ hours: 2 }).startOf('second')

    await withWorker(true, async (worker) => {
      const entry = await SendReport.schedule({ reportId: 3 }, when)
      const state = scheduleState(worker)
      const stored = await reloadJob(entry.id)

      assert.equal(stored.status, JobQueueItemStatus.New)
      assert.equal(stored.dueDate?.toUnixInteger(), when.toUnixInteger())
      assert.closeTo(state.timedQueueDelay, when.diff(DateTime.now(), 'seconds').seconds, 5)
      assert.isNotNull(state.timedQueueTimeout)
      assert.lengthOf(recordingBus.published, 1)
    })
  })

  test('caps the timed worker wait at 20 days', async ({ assert }) => {
    setBusEnabled(true)
    const when = DateTime.now().plus({ days: 30 }).startOf('second')

    await withWorker(true, async (worker) => {
      const entry = await SendReport.schedule({ reportId: 4 }, when)
      const stored = await reloadJob(entry.id)

      assert.equal(stored.status, JobQueueItemStatus.New)
      assert.equal(stored.dueDate?.toUnixInteger(), when.toUnixInteger())
      assert.equal(scheduleState(worker).timedQueueDelay, MAX_WAIT_SECONDS)
    })
  })

  test('keeps the earlier wait for a later job and pulls it forward for a sooner one', async ({
    assert,
  }) => {
    setBusEnabled(true)
    const middle = DateTime.now().plus({ hours: 5 }).startOf('second')
    const later = DateTime.now().plus({ hours: 8 }).startOf('second')
    const sooner = DateTime.now().plus({ hours: 1 }).startOf('second')

    await withWorker(true, async (worker) => {
      const state = scheduleState(worker)
      const first = await SendReport.schedule({ reportId: 5 }, middle)
      const armed = state.timedQueueDelay
      assert.closeTo(armed, middle.diff(DateTime.now(), 'seconds').seconds, 5)

      const second = await SendReport.schedule({ reportId: 6 }, later)
      assert.equal(state.timedQueueDelay, armed)

      const third = await SendReport.schedule({ reportId: 7 }, sooner)
      assert.closeTo(state.timedQueueDelay, sooner.diff(DateTime.now(), 'seconds').seconds, 5)
      assert.isBelow(state.timedQueueDelay, armed)

      const storedFirst = await reloadJob(first.id)
      const storedSecond = await reloadJob(second.id)
      const storedThird = await reloadJob(third.id)
      assert.equal(storedFirst.status, JobQueueItemStatus.New)
      assert.equal(storedSecond.dueDate?.toUnixInteger(), later.toUnixInteger())
      assert.equal(storedThird.dueDate?.toUnixInteger(), sooner.toUnixInteger())
    })
  })

  test('stores a sooner job without moving the wait after the bus is turned off', async ({
    assert,
  }) => {
    setBusEnabled(true)
    const firstWhen = DateTime.now().plus({ hours: 5 }).startOf('second')
    const sooner = DateTime.now().plus({ hours: 1 }).startOf('second')

    await withWorker(true, async (worker) => {
      const state = scheduleState(worker)
      await SendReport.schedule({ reportId: 8 }, firstWhen)
      const armed = state.timedQueueDelay

      setBusEnabled(false)
      const entry = await SendReport.schedule({ reportId: 9 }, sooner)
      const stored = await reloadJob(entry.id)

      assert.equal(state.timedQueueDelay, armed)
      assert.lengthOf(recordingBus.published, 1)
      assert.equal(stored.status, JobQueueItemStatus.New)
      assert.equal(stored.dueDate?.toUnixInteger(), sooner.toUnixInteger())
    })
  })

  test('does not claim an immediate job from the timed worker', async ({ assert }) => {
    setBusEnabled(true)

    await withPopCount(async (calls) => {
      await withWorker(true, async (worker) => {
        assert.deepEqual(calls, [true])
        const entry = await SendReport.schedule({ reportId: 10 }, null)
        const stored = await reloadJob(entry.id)

        assert.deepEqual(calls, [true])
        assert.equal(scheduleState(worker).timedQueueDelay, 0)
        assert.isNull(scheduleState(worker).timedQueueTimeout)
        assert.equal(stored.status, JobQueueItemStatus.New)
        assert.isNull(stored.dueDate)
      })
    })
  })

  test('arms the timed worker from a job stored before it starts', async ({ assert }) => {
    setBusEnabled(false)
    const when = DateTime.now().plus({ hours: 2 }).startOf('second')
    const entry = await SendReport.schedule({ reportId: 12 }, when)

    await withWorker(true, async (worker) => {
      const state = scheduleState(worker)
      const stored = await reloadJob(entry.id)

      assert.isAbove(state.timedQueueDelay, 0)
      assert.isNotNull(state.timedQueueTimeout)
      assert.equal(stored.status, JobQueueItemStatus.New)
      assert.equal(stored.dueDate?.toUnixInteger(), when.toUnixInteger())
    })
  })

  test('does not claim a timed job from the immediate worker', async ({ assert }) => {
    setBusEnabled(true)
    const when = DateTime.now().plus({ hours: 3 }).startOf('second')

    await withPopCount(async (calls) => {
      await withWorker(false, async () => {
        assert.deepEqual(calls, [false])
        const entry = await SendReport.schedule({ reportId: 11 }, when)
        const stored = await reloadJob(entry.id)

        assert.deepEqual(calls, [false])
        assert.equal(stored.status, JobQueueItemStatus.New)
        assert.equal(stored.dueDate?.toUnixInteger(), when.toUnixInteger())
      })
    })
  })
})
