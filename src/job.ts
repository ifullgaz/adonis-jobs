import app from '@adonisjs/core/services/app'
import { type DateTime } from 'luxon'
import JobQueueEntry from './model/job_queue_entry.js'
import type JobQueueService from './core/job_queue_service.js'

abstract class Job<Payload = unknown> {
  public static async schedule<T extends Job<any>>(
    this: abstract new (...args: any[]) => T,
    payload: T extends Job<infer P> ? P : never,
    when: DateTime | null = null
  ): Promise<JobQueueEntry> {
    const data = {
      jobName: this.name,
      jobParams: payload,
      dueDate: when,
    }
    return await JobQueueEntry.store(data)
  }

  public abstract run(payload: Payload): Promise<void>

  public static async findRunningJob(
    filter?: object,
    wait?: boolean
  ): Promise<JobQueueEntry | null> {
    const jobQueueService = (await app.container.make('jobQueueService')) as JobQueueService
    return await jobQueueService.findRunningJob(this.name, filter, wait)
  }

  public static async findScheduledJob(
    filter?: object,
    cancelWithReason?: object
  ): Promise<JobQueueEntry | null> {
    const jobQueueService = (await app.container.make('jobQueueService')) as JobQueueService
    return await jobQueueService.findScheduledJob(this.name, filter, cancelWithReason)
  }
}

export default Job
