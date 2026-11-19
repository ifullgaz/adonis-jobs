import { test } from '@japa/runner'
import type { BaseCommand } from '@adonisjs/core/ace'
import JobQueueRunCommand from '../src/commands/run.js'
import JobQueueWorker from '../src/core/job_queue_worker.js'
import { getApp, resetQueue } from './helpers/app.js'

type WorkerState = {
  timed: boolean
  running: boolean
}

test.group('job-queue:run', (group) => {
  group.each.setup(async () => {
    await resetQueue()
    const app = getApp()
    if (!app.container.hasBinding('jobQueueWorker')) {
      app.container.singleton('jobQueueWorker', async () => {
        return new JobQueueWorker(app)
      })
    }
  })

  test('starts the immediate worker', async ({ assert }) => {
    const worker = (await getApp().container.make('jobQueueWorker')) as JobQueueWorker
    try {
      const command = await run([])
      const state = worker as unknown as WorkerState
      assert.equal(command.exitCode, 0)
      assert.notOk(state.timed)
      assert.isTrue(state.running)
    } finally {
      await worker.stop()
    }
  })

  test('starts the timed worker', async ({ assert }) => {
    const worker = (await getApp().container.make('jobQueueWorker')) as JobQueueWorker
    try {
      const command = await run(['--timed'])
      const state = worker as unknown as WorkerState
      assert.equal(command.exitCode, 0)
      assert.isTrue(state.timed)
      assert.isTrue(state.running)
    } finally {
      await worker.stop()
    }
  })
})

async function run(argv: string[]) {
  const ace = await getApp().container.make('ace')
  const command = await ace.create(JobQueueRunCommand, argv)
  command.ui.switchMode('silent')
  await command.exec()
  return command as JobQueueRunCommand & BaseCommand
}
