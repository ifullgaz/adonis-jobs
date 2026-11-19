import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { type JobQueueWorkerContract } from '../core/contracts/job_queue_worker_contract.js'

export default class JobQueueRunCommand extends BaseCommand {
  static commandName = 'job-queue:run'
  static description = 'Run the job queue'
  static options: CommandOptions = {
    startApp: true,
    staysAlive: true,
  }

  private jobQueueWorker!: JobQueueWorkerContract

  @flags.boolean()
  declare timed: boolean

  async prepare() {
    this.jobQueueWorker = await this.app.container.make('jobQueueWorker')
    this.app.terminating(async () => {
      await this.jobQueueWorker.stop()
    })
  }

  async run() {
    await this.jobQueueWorker.start(this.timed)
  }
}
