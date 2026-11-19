import { test } from '@japa/runner'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import Job from '../src/job.js'
import type JobQueueService from '../src/core/job_queue_service.js'
import JobQueueWorker from '../src/core/job_queue_worker.js'
import JobQueueEntry from '../src/model/job_queue_entry.js'
import { JobQueueItemStatus } from '../src/types/types.js'
import { getApp, resetQueue, setBusEnabled } from './helpers/app.js'
import { reloadJob } from './helpers/queue.js'
import SendReport from './helpers/send_report_job.js'

class ExplodingJob extends Job<{ n: number }> {
  static exploded = false

  async run() {
    ExplodingJob.exploded = true
    throw new Error('boom')
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function queue() {
  const app = getApp()
  return (await app.container.make('jobQueueService')) as JobQueueService
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

test.group('Job worker execution', (group) => {
  group.each.setup(async () => {
    SendReport.executed = []
    ExplodingJob.exploded = false
    await resetQueue()
  })

  test('starting or stopping twice leaves the worker idle', async ({ assert }) => {
    const worker = new JobQueueWorker(getApp())
    const state = worker as unknown as { running: boolean }
    await worker.stop()
    assert.isFalse(state.running)
    await worker.start(false)
    await worker.start(false)
    await worker.start(true)
    assert.isTrue(state.running)
    await worker.stop()
    await worker.stop()
    assert.isFalse(state.running)
  })

  test('skips a nested run while a pass is already in progress', async ({ assert }) => {
    setBusEnabled(true)
    const service = await queue()
    const calls: string[] = []
    const original = service.pop.bind(service)
    service.pop = async (timed) => {
      calls.push(timed ? 'timed' : 'immediate')
      if (calls.length === 1) {
        await service.publish({ timed: null })
      }
      return original(timed)
    }
    try {
      await withWorker(false, async () => {
        assert.deepEqual(calls, ['immediate', 'immediate'])
      })
    } finally {
      service.pop = original
    }
  })

  test('logs a claim failure without losing the queued job', async ({ assert }) => {
    setBusEnabled(true)
    const logged: unknown[] = []
    const original = logger.error.bind(logger)
    logger.error = ((message: unknown, ...args: unknown[]) => {
      logged.push(message)
      return original(message as string, ...(args as []))
    }) as typeof logger.error
    try {
      await withWorker(false, async () => {
        const entry = await SendReport.schedule({ reportId: 1 }, null)
        await sleep(30)
        const stored = await reloadJob(entry.id)
        assert.equal(stored.status, JobQueueItemStatus.New)
        assert.isTrue(logged.some((message) => String(message).includes('immutable')))
      })
    } finally {
      logger.error = original as typeof logger.error
    }
  })

  test('runs the timeout body for a job that is already due', async ({ assert }) => {
    setBusEnabled(true)
    const service = await queue()
    const calls: boolean[] = []
    const original = service.pop.bind(service)
    service.pop = async (timed) => {
      calls.push(timed)
      return original(timed)
    }
    try {
      await withWorker(true, async () => {
        await service.publish({ timed: Math.floor(Date.now() / 1000) - 30 })
        await sleep(30)
        assert.deepEqual(calls, [true, true])
      })
    } finally {
      service.pop = original
    }
  })

  test('closes the database when the worker stops during a pass', async ({ assert }) => {
    const service = await queue()
    const manager = db.manager as { closeAll: () => unknown }
    const originalClose = manager.closeAll.bind(db.manager)
    let closed = 0
    manager.closeAll = () => {
      closed += 1
      return Promise.resolve()
    }
    const originalPop = service.pop.bind(service)
    const worker = new JobQueueWorker(getApp())
    service.pop = async () => {
      await worker.stop()
      return undefined
    }
    try {
      await worker.start(false)
      assert.equal(closed, 1)
    } finally {
      service.pop = originalPop
      manager.closeAll = originalClose
      await worker.stop()
    }
  })

  test('fails a job that has no name without writing the failure', async ({ assert }) => {
    const service = await queue()
    const entry = await JobQueueEntry.store({
      jobName: '',
      jobParams: { reportId: 2 },
      status: JobQueueItemStatus.New,
    })
    const original = service.pop.bind(service)
    let served = false
    service.pop = async () => {
      if (served) {
        return undefined
      }
      served = true
      return entry
    }
    try {
      await withWorker(false, async () => {
        const stored = await reloadJob(entry.id)
        assert.equal(stored.status, JobQueueItemStatus.New)
        assert.equal(stored.jobName, '')
      })
    } finally {
      service.pop = original
    }
  })

  test('records a missing job class without saving the not-found status', async ({ assert }) => {
    const service = await queue()
    const entry = await JobQueueEntry.store({
      jobName: 'MissingJob',
      jobParams: { reportId: 3 },
      status: JobQueueItemStatus.Processing,
    })
    const original = service.pop.bind(service)
    service.pop = async () => {
      service.pop = original
      return entry
    }
    try {
      await withWorker(false, async () => {
        const stored = await reloadJob(entry.id)
        assert.equal(stored.status, JobQueueItemStatus.Processing)
      })
    } finally {
      service.pop = original
    }
  })

  test('runs a registered job and keeps the row when completion cannot be saved', async ({
    assert,
  }) => {
    const app = getApp()
    const registry = await app.container.make('jobsRegistry')
    await registry.registerJob(SendReport)
    const service = await queue()
    const entry = await JobQueueEntry.store({
      jobName: 'SendReport',
      jobParams: { reportId: 4 },
      status: JobQueueItemStatus.Processing,
    })
    const original = service.pop.bind(service)
    service.pop = async () => {
      service.pop = original
      return entry
    }
    try {
      await withWorker(false, async () => {
        assert.deepEqual(SendReport.executed, [{ reportId: 4 }])
        const stored = await reloadJob(entry.id)
        assert.equal(stored.status, JobQueueItemStatus.Processing)
      })
    } finally {
      service.pop = original
    }
  })

  test('catches a job error and then refuses to save the failure', async ({ assert }) => {
    const app = getApp()
    const registry = await app.container.make('jobsRegistry')
    await registry.registerJob(ExplodingJob)
    const service = await queue()
    const entry = await JobQueueEntry.store({
      jobName: 'ExplodingJob',
      jobParams: { n: 1 },
      status: JobQueueItemStatus.Processing,
    })
    const original = service.pop.bind(service)
    service.pop = async () => entry
    const worker = new JobQueueWorker(app)
    try {
      await assert.rejects(() => worker.start(false), /immutable/)
      assert.isTrue(ExplodingJob.exploded)
      const stored = await reloadJob(entry.id)
      assert.equal(stored.status, JobQueueItemStatus.Processing)
    } finally {
      service.pop = original
      await worker.stop()
    }
  })

  test('logs a missing job when the not-found update succeeds', async ({ assert }) => {
    const service = await queue()
    const original = service.pop.bind(service)
    let notFound = 0
    let served = false
    service.pop = async () => {
      if (served) {
        return undefined
      }
      served = true
      return {
        id: 1,
        jobName: 'MissingJob',
        jobParams: {},
        process: async () => {},
        notFound: async () => {
          notFound += 1
        },
        fail: async () => {},
      } as unknown as JobQueueEntry
    }
    try {
      await withWorker(false, async () => {
        assert.equal(notFound, 1)
      })
    } finally {
      service.pop = original
    }
  })

  test('completes a job when the status update succeeds', async ({ assert }) => {
    const app = getApp()
    const registry = await app.container.make('jobsRegistry')
    await registry.registerJob(SendReport)
    const service = await queue()
    const original = service.pop.bind(service)
    let completed = 0
    let served = false
    service.pop = async () => {
      if (served) {
        return undefined
      }
      served = true
      return {
        id: 8,
        jobName: 'SendReport',
        jobParams: { reportId: 8 },
        process: async () => {},
        complete: async () => {
          completed += 1
        },
        fail: async () => {},
        notFound: async () => {},
      } as unknown as JobQueueEntry
    }
    try {
      await withWorker(false, async () => {
        assert.equal(completed, 1)
        assert.deepEqual(SendReport.executed, [{ reportId: 8 }])
      })
    } finally {
      service.pop = original
    }
  })
})
