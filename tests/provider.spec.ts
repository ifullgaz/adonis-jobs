import { test } from '@japa/runner'
import { IgnitorFactory } from '@adonisjs/core/factories'
import JobsRegistry from '../src/core/jobs_registry.js'
import JobQueueService from '../src/core/job_queue_service.js'
import JobQueueWorker from '../src/core/job_queue_worker.js'
import { getApp, restoreTestApp } from './helpers/app.js'

test.group('Jobs provider', () => {
  test('resolves the registry from the booted application', async ({ assert }) => {
    const app = getApp()
    const first = await app.container.make('jobsRegistry')
    const second = await app.container.make('jobsRegistry')

    assert.instanceOf(first, JobsRegistry)
    assert.strictEqual(first, second)
  })

  test('registers the worker when the application is a console app', async ({ assert }) => {
    const app = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .merge({
        rcFileContents: {
          providers: [() => import('../providers/provider.js')],
        },
      })
      .create(new URL('../', import.meta.url), {
        importer: (filePath) => import(filePath),
      })
      .createApp('console')

    try {
      await app.init()
      await app.boot()
      const worker = await app.container.make('jobQueueWorker')
      assert.instanceOf(worker, JobQueueWorker)
    } finally {
      await app.terminate()
      restoreTestApp()
    }
  })

  test('resolves the queue service when no bus factory is configured', async ({ assert }) => {
    const app = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .merge({
        rcFileContents: {
          providers: [() => import('../providers/provider.js')],
        },
      })
      .create(new URL('../', import.meta.url), {
        importer: (filePath) => import(filePath),
      })
      .createApp('web')

    try {
      await app.init()
      await app.boot()
      app.config.set('jobQueue', {
        bus: {
          enabled: false,
          channel: 'job-queue:process',
        },
      })
      const service = await app.container.make('jobQueueService')
      assert.instanceOf(service, JobQueueService)
    } finally {
      await app.terminate()
      restoreTestApp()
    }
  })
})
