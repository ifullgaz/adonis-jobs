import { type BusContract, type JobQueueConfig, JobQueueItemStatus } from '../types/types.js'
import { sleep } from '@ifullgaz/adonis-lucid/utils'
import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { JobQueueServiceContract } from './contracts/job_queue_service_contract.js'
import JobQueueEntry from '../model/job_queue_entry.js'

export type JobMessage = {
  timed: number | null
}

export default class JobQueueService implements JobQueueServiceContract {
  constructor(
    private readonly config: JobQueueConfig,
    private readonly bus: BusContract | undefined
  ) {}

  private async top(timed: boolean, trx: TransactionClientContract): Promise<JobQueueEntry | null> {
    const query = JobQueueEntry.query({ client: trx })
      .where('status', JobQueueItemStatus.New)
      .orderBy('dueDate', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .skipLocked()
    if (timed) {
      const now = new Date()
      query.andWhere('dueDate', '<=', now)
    } else {
      query.andWhereNull('dueDate')
    }
    return await query.first()
  }

  public async pop(timed: boolean): Promise<JobQueueEntry | undefined> {
    return await db.transaction(
      async (trx) => {
        const job = await this.top(timed, trx)
        if (job) {
          job.useTransaction(trx)
          job.status = JobQueueItemStatus.Reserved
          return await job.save()
        }
      },
      {
        isolationLevel: 'read committed',
      }
    )
  }

  public async findRunningJob(
    name: string,
    filter?: object,
    wait?: boolean
  ): Promise<JobQueueEntry | null> {
    const query = JobQueueEntry.query()
      .where('jobName', name)
      .whereIn('status', [JobQueueItemStatus.Processing, JobQueueItemStatus.Reserved])
      .orderBy('id', 'desc')
      .forUpdate()
      .skipLocked()
    if (filter) {
      query.whereJsonSuperset('jobParams', filter)
    }
    let job = await query.first()
    let delay = 100 // Initial delay of 100ms
    while (wait && job && job.isRunning) {
      await sleep(delay)
      job = await JobQueueEntry.find(job.id)
      delay = Math.min(1000, delay * 2) // Exponential backoff
    }
    return job
  }

  public async findScheduledJob(
    name?: string,
    filter?: object,
    cancelWithReason?: object
  ): Promise<JobQueueEntry | null> {
    const now = new Date()
    const scheduledJob = await db.transaction(async (trx) => {
      const query = JobQueueEntry.query({ client: trx })
        .where('status', JobQueueItemStatus.New)
        .where('dueDate', '>', now)
        .orderBy('dueDate', 'asc')
        .forUpdate()
        .skipLocked()
      if (name) {
        query.where('jobName', name)
      }
      if (filter) {
        query.whereJsonSuperset('jobParams', filter)
      }
      let job = await query.first()
      if (job && cancelWithReason) {
        job.useTransaction(trx)
        await job.cancel(cancelWithReason)
      }
      return job
    })
    return scheduledJob
  }

  public async unsubscribe(): Promise<void> {
    if (this.config.bus.enabled && this.bus) {
      await this.bus.unsubscribe(this.bus.prefixedKey(this.config.bus.channel))
    }
  }

  public async subscribe(handler: (message: JobMessage) => void): Promise<void> {
    if (this.config.bus.enabled && this.bus) {
      await this.bus.subscribe(this.bus.prefixedKey(this.config.bus.channel), handler)
    }
  }

  public async publish(message: JobMessage): Promise<void> {
    if (this.config.bus.enabled && this.bus) {
      await this.bus.publish(this.bus.prefixedKey(this.config.bus.channel), message)
    }
  }
}
