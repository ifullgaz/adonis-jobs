import type { JobType } from '../../types/types.js'

export interface JobsRegistryContract {
  getJobs(): Promise<Record<string, JobType>>
  getJob(name: string): Promise<JobType | undefined>
  hasJob(name: string): Promise<boolean>
  registerJob(job: JobType): Promise<void>
}
