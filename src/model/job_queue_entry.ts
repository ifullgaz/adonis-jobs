import app from '@adonisjs/core/services/app'
import { DateTime } from 'luxon'
import { compose } from '@adonisjs/core/helpers'
import { afterSave, beforeUpdate, BaseModel, column } from '@adonisjs/lucid/orm'
import { json, dateTime } from '@ifullgaz/adonis-lucid/columns'
import { withScopedModel } from '@ifullgaz/adonis-lucid/traits'
import { JobQueueItemStatus } from '../types/types.js'
import type JobQueueService from '../core/job_queue_service.js'

export default class JobQueueEntry extends compose(BaseModel, withScopedModel()) {
  public static table = 'job_queue'

  public static defaultValues(): Partial<JobQueueEntry> {
    return {
      status: JobQueueItemStatus.New,
      jobParams: {},
      reason: {},
    }
  }

  @beforeUpdate()
  static preventUpdate() {
    throw new Error('Job queue entries are immutable and cannot be updated')
  }

  @afterSave()
  static async publish(entry: JobQueueEntry) {
    if (entry.status === JobQueueItemStatus.New) {
      const jobQueueService = (await app.container.make('jobQueueService')) as JobQueueService
      await jobQueueService.publish({ timed: entry.dueDate ? entry.dueDate.toUnixInteger() : null })
    }
  }

  @column({ isPrimary: true })
  declare id: number
  @column()
  declare jobName: string
  @json()
  declare jobParams: object
  @column({ serialize: (value) => JobQueueItemStatus[value] })
  declare status: JobQueueItemStatus
  @dateTime()
  declare dueDate: DateTime | null
  @dateTime()
  declare startDate: DateTime | null
  @dateTime()
  declare endDate: DateTime | null
  @json()
  declare reason: object

  @dateTime({ autoCreate: true })
  declare createdAt: DateTime
  @dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  public get isRunning() {
    return (
      this.status === JobQueueItemStatus.Processing || this.status === JobQueueItemStatus.Reserved
    )
  }

  public async process() {
    if (this.status === JobQueueItemStatus.Processing) {
      return this
    }
    if (this.status !== JobQueueItemStatus.Reserved) {
      return this
    }
    this.status = JobQueueItemStatus.Processing
    this.startDate = DateTime.now()
    return await this.save()
  }

  public async complete() {
    if (this.status === JobQueueItemStatus.Completed) {
      return this
    }
    if (this.status !== JobQueueItemStatus.Processing) {
      return this
    }
    this.endDate = DateTime.now()
    this.status = JobQueueItemStatus.Completed
    return await this.save()
  }

  public async fail(reason: object) {
    if (this.status === JobQueueItemStatus.Failed) {
      return this
    }
    if (
      this.status !== JobQueueItemStatus.Reserved &&
      this.status !== JobQueueItemStatus.Processing
    ) {
      return this
    }
    this.endDate = DateTime.now()
    this.status = JobQueueItemStatus.Failed
    this.reason = reason
    return await this.save()
  }

  public async cancel(reason: object) {
    if (this.status === JobQueueItemStatus.Cancelled) {
      return this
    }
    if (this.status !== JobQueueItemStatus.New) {
      return this
    }
    this.endDate = DateTime.now()
    this.status = JobQueueItemStatus.Cancelled
    this.reason = reason
    return await this.save()
  }

  public async notFound(reason: object) {
    if (this.status === JobQueueItemStatus.NotFound) {
      return this
    }
    if (this.status !== JobQueueItemStatus.Processing) {
      return this
    }
    this.endDate = DateTime.now()
    this.status = JobQueueItemStatus.NotFound
    this.reason = reason
    return await this.save()
  }
}
