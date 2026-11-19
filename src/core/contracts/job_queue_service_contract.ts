import type JobQueueEntry from '../../model/job_queue_entry.js'

export interface JobQueueServiceContract {
  findRunningJob(name: string, filter?: object, wait?: boolean): Promise<JobQueueEntry | null>
  findScheduledJob(
    name?: string,
    filter?: object,
    cancelWithReason?: object
  ): Promise<JobQueueEntry | null>
}
