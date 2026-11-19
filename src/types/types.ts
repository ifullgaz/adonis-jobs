import type Job from '../job.js'

// Define the numeric literal union type
export enum JobQueueItemStatus {
  New = 0,
  Reserved = 1,
  Processing = 2,
  Completed = 3,
  Failed = 4,
  Cancelled = 5,
  NotFound = 6,
}

export type JobClass = {
  name: string
  schedule: typeof Job.schedule
  findRunningJob: typeof Job.findRunningJob
  findScheduledJob: typeof Job.findScheduledJob
}

export type JobConstructor = new (...args: any[]) => Job<any>

export type JobType = JobClass & JobConstructor

export interface JobsListContract {
  getJobs(): Promise<Record<string, JobType>>
  getJob(name: string): Promise<JobType | undefined>
  registerJob(job: JobType): Promise<void>
}

export type SubscribeHandler<T extends Serializable> = (payload: T) => void | Promise<void>

export type Serializable =
  string | number | boolean | null | Serializable[] | { [key: string]: Serializable }

export interface BusContract {
  prefixedKey(key: string, connectionName?: string): string
  publish(channel: string, message: Serializable): Promise<boolean>
  subscribe<T extends Serializable>(channel: string, handler: SubscribeHandler<T>): Promise<void>
  unsubscribe(channel: string): Promise<void>
}

export type BusFactory = (transport?: string) => Promise<BusContract>

export type JobQueueConfig = {
  bus: {
    factory?: BusFactory
    enabled: boolean
    channel: string
  }
}
