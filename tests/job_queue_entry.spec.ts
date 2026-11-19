import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import JobQueueEntry from '../src/model/job_queue_entry.js'
import { JobQueueItemStatus } from '../src/types/types.js'
import { resetQueue } from './helpers/app.js'

const IMMUTABLE = /Job queue entries are immutable and cannot be updated/

test.group('Job queue entry', (group) => {
  group.each.setup(async () => {
    await resetQueue()
  })

  test('stores defaults and reports whether a job is running', async ({ assert }) => {
    const entry = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 1 },
    })

    assert.equal(entry.status, JobQueueItemStatus.New)
    assert.deepEqual(entry.jobParams, { reportId: 1 })
    assert.deepEqual(entry.reason, {})
    assert.isFalse(entry.isRunning)
    assert.equal(entry.serialize().status, 'New')

    entry.status = JobQueueItemStatus.Reserved
    assert.isTrue(entry.isRunning)
    entry.status = JobQueueItemStatus.Processing
    assert.isTrue(entry.isRunning)
    entry.status = JobQueueItemStatus.Completed
    assert.isFalse(entry.isRunning)
  })

  test('ignores status changes that the current state does not allow', async ({ assert }) => {
    const entry = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 2 },
      status: JobQueueItemStatus.New,
    })

    assert.strictEqual(await entry.process(), entry)
    assert.strictEqual(await entry.complete(), entry)
    assert.strictEqual(await entry.fail({ reason: 'nope' }), entry)
    assert.strictEqual(await entry.notFound({ reason: 'missing' }), entry)

    entry.status = JobQueueItemStatus.Reserved
    assert.strictEqual(await entry.cancel({ reason: 'too late' }), entry)

    entry.status = JobQueueItemStatus.Completed
    assert.strictEqual(await entry.complete(), entry)
    entry.status = JobQueueItemStatus.Failed
    assert.strictEqual(await entry.fail({ reason: 'again' }), entry)
    entry.status = JobQueueItemStatus.Cancelled
    assert.strictEqual(await entry.cancel({ reason: 'again' }), entry)
    entry.status = JobQueueItemStatus.NotFound
    assert.strictEqual(await entry.notFound({ reason: 'again' }), entry)
    entry.status = JobQueueItemStatus.Processing
    assert.strictEqual(await entry.process(), entry)

    const fresh = await JobQueueEntry.find(entry.id)
    assert.equal(fresh?.status, JobQueueItemStatus.New)
  })

  test('refuses to persist a status transition', async ({ assert }) => {
    const reservedForProcess = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 3 },
      status: JobQueueItemStatus.Reserved,
    })
    const reservedForFail = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 4 },
      status: JobQueueItemStatus.Reserved,
    })
    const processingForComplete = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 5 },
      status: JobQueueItemStatus.Processing,
    })
    const processingForFail = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 6 },
      status: JobQueueItemStatus.Processing,
    })
    const processingForNotFound = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 7 },
      status: JobQueueItemStatus.Processing,
    })
    const queued = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 8 },
      dueDate: DateTime.now().plus({ hours: 1 }),
    })

    await assert.rejects(() => reservedForProcess.process(), IMMUTABLE)
    await assert.rejects(() => reservedForFail.fail({ reason: 'exploded' }), IMMUTABLE)
    await assert.rejects(() => processingForComplete.complete(), IMMUTABLE)
    await assert.rejects(() => processingForFail.fail({ reason: 'exploded' }), IMMUTABLE)
    await assert.rejects(() => processingForNotFound.notFound({ reason: 'missing' }), IMMUTABLE)
    await assert.rejects(() => queued.cancel({ reason: 'replaced' }), IMMUTABLE)

    const storedReserved = await JobQueueEntry.find(reservedForProcess.id)
    const storedProcessing = await JobQueueEntry.find(processingForComplete.id)
    const storedQueued = await JobQueueEntry.find(queued.id)
    assert.equal(storedReserved?.status, JobQueueItemStatus.Reserved)
    assert.equal(storedProcessing?.status, JobQueueItemStatus.Processing)
    assert.equal(storedQueued?.status, JobQueueItemStatus.New)
  })
})
