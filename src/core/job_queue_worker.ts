import { DateTime } from 'luxon'
import { type ApplicationService } from '@adonisjs/core/types'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import type Job from '../job.js'
import { type JobMessage } from './job_queue_service.js'
import type JobQueueService from './job_queue_service.js'
import type JobQueueEntry from '../model/job_queue_entry.js'
import { type JobQueueWorkerContract } from './contracts/job_queue_worker_contract.js'

const MAX_INTERVAL_DAYS = 20

const getDelayFromDueDate = (dueDate: DateTime): number => {
  const now = DateTime.now()
  const daysUntilDue = dueDate.diff(now, 'days').days
  if (daysUntilDue > MAX_INTERVAL_DAYS) {
    return MAX_INTERVAL_DAYS * 24 * 60 * 60 // 20 days in seconds
  } else {
    return daysUntilDue >= 0 ? dueDate.diff(now, 'seconds').seconds : 0
  }
}

class JobQueueWorker implements JobQueueWorkerContract {
  private timed: boolean = false

  private running: boolean = false

  private processing: boolean = false

  private retryProcessing: boolean = false

  private timedQueueTimeout: NodeJS.Timeout | null = null

  private timedQueueDelay: number = 0 // seconds

  private jobQueue!: JobQueueService

  constructor(private readonly app: ApplicationService) {}

  private async processJob(item: JobQueueEntry) {
    const jobName = item.jobName
    if (!jobName) {
      logger.debug(`[JobQueueWorker] Job #${item.id} has no job name, failing`)
      await item.fail({
        reason: 'Job name not specified',
      })
      return
    }
    await item.process()
    logger.trace(`[JobQueueWorker] Job #${item.id} (${jobName}) processing`)
    try {
      const jobsRegistry = await this.app.container.make('jobsRegistry')
      const jobClass = await jobsRegistry.getJob(jobName)
      if (!jobClass) {
        await item.notFound({
          reason: `Cannot find job ${jobName}`,
        })
        logger.error(`[JobQueueWorker] Cannot find job ${jobName}`)
        return
      }
      const job = (await this.app.container.make(jobClass)) as Job
      await job.run(item.jobParams)
      await item.complete()
      logger.trace(`[JobQueueWorker] Job #${item.id} (${jobName}) completed`)
    } catch (error) {
      logger.trace(
        `[JobQueueWorker] Job #${item.id} (${jobName}) failed: ${(error as Error).message}`
      )
      await item.fail({
        reason: (error as Error).message,
      })
    }
  }

  private async processJobs() {
    if (this.processing) {
      logger.trace('[JobQueueWorker] Job queue already processing, skipping')
      return
    }
    this.processing = true
    let job: JobQueueEntry | undefined
    do {
      this.retryProcessing = false
      job = await this.jobQueue.pop(this.timed)
      if (job) {
        await this.processJob(job)
      }
    } while ((job || this.retryProcessing) && this.running)
    logger.trace(`[JobQueueWorker] Job queue finished processing jobs`)
    this.processing = false
    // Close the database connection if the worker is stopped during processing
    if (!this.running) {
      db.manager.closeAll()
    }
  }

  private async waitForScheduledJob() {
    // Find the next scheduled job in the queue
    const nextJob = await this.jobQueue.findScheduledJob()
    // If there is a next job, set the interval based on the due date
    this.timedQueueDelay = 0
    if (nextJob && nextJob.dueDate) {
      this.timedQueueDelay = getDelayFromDueDate(nextJob.dueDate)
      logger.trace(
        `[JobQueueWorker] Next scheduled job #${nextJob.id} (${nextJob.jobName}) due in ${this.timedQueueDelay}s`
      )
      // If the next date is in the future, set the interval with the delay
      this.setupTimedQueueTimeout(this.timedQueueDelay)
    } else {
      logger.trace('[JobQueueWorker] No scheduled jobs pending')
    }
  }

  private setupTimedQueueTimeout(delay: number) {
    logger.trace(`[JobQueueWorker] Timed queue timeout set for ${delay}s`)
    this.cleanupTimedQueueTimeout()
    this.timedQueueTimeout = setTimeout(async () => {
      await this.processJobs()
      await this.waitForScheduledJob()
    }, delay * 1000)
  }

  private cleanupTimedQueueTimeout() {
    if (this.timedQueueTimeout) {
      clearTimeout(this.timedQueueTimeout)
      this.timedQueueTimeout = null
    }
  }

  private async onMessage(message: JobMessage) {
    if (this.timed && 'timed' in message && message.timed !== null) {
      const dueDate = DateTime.fromSeconds(message.timed)
      const timedQueueDelay = getDelayFromDueDate(dueDate)
      if (!this.timedQueueDelay || this.timedQueueDelay > timedQueueDelay) {
        logger.trace(
          `[JobQueueWorker] Received timed message, rescheduling timeout from ${this.timedQueueDelay}s to ${timedQueueDelay}s`
        )
        this.timedQueueDelay = timedQueueDelay
        this.setupTimedQueueTimeout(timedQueueDelay)
      } else {
        logger.trace(
          `[JobQueueWorker] Received timed message, delay ${timedQueueDelay}s >= current ${this.timedQueueDelay}s, not rescheduling`
        )
      }
    } else if (!this.timed && !message.timed) {
      logger.trace('[JobQueueWorker] Received job message, triggering processing')
      this.retryProcessing = true
      await this.processJobs()
    }
    logger.trace(`[JobQueueWorker] Job queue message onMessage processed`)
  }

  private async preProcessJobs() {
    // Process all jobs that it can
    await this.processJobs()
    // If timed queue, set the interval based on the next job's due date
    if (this.timed) {
      await this.waitForScheduledJob()
    }
  }

  public async stop() {
    if (!this.running) {
      logger.debug(
        `[JobQueueWorker] ${this.timed ? 'Timed job' : 'Job'} queue worker already stopped`
      )
      return
    }
    logger.debug(`[JobQueueWorker] ${this.timed ? 'Timed job' : 'Job'} queue worker stopping`)
    this.running = false
    await this.jobQueue.unsubscribe()
    this.cleanupTimedQueueTimeout()
    logger.debug(`[JobQueueWorker] ${this.timed ? 'Timed job' : 'Job'} queue worker stopped`)
  }

  public async start(timed: boolean) {
    logger.debug(`[JobQueueWorker] ${timed ? 'Timed job' : 'Job'} queue worker starting`)
    if (this.running) {
      logger.debug(`[JobQueueWorker] ${timed ? 'Timed job' : 'Job'} queue worker already running`)
      return
    }
    this.running = true
    this.timed = timed
    this.jobQueue = (await this.app.container.make('jobQueueService')) as JobQueueService
    await this.jobQueue.subscribe((message: JobMessage) => {
      this.onMessage(message).catch((error) => {
        logger.error(`[JobQueueWorker] Error processing job message: ${(error as Error).message}`)
      })
      logger.trace(`[JobQueueWorker] Job queue message processed`)
    })
    // Pick up jobs queued before the worker started
    await this.preProcessJobs()
    logger.debug(`[JobQueueWorker] ${timed ? 'Timed job' : 'Job'} queue worker started`)
  }
}

export default JobQueueWorker
