import app from '@adonisjs/core/services/app'
import vine, { VineString } from '@vinejs/vine'
import { type FieldContext } from '@vinejs/vine/types'
import { DateTime } from 'luxon'

declare module '@vinejs/vine' {
  interface VineString {
    jobName(): this
  }
}

VineString.macro('jobName', function (this: VineString) {
  return (this as any).use(jobNameRule())
})

const jobName = async (value: unknown, _options: any, field: FieldContext) => {
  if (typeof value !== 'string') {
    return
  }
  const jobsRegistry = await app.container.make('jobsRegistry')
  if (!(await jobsRegistry.hasJob(value))) {
    field.report('The value of {{ field }} is not a valid job name', 'jobName', field)
  }
}

const jobNameRule = vine.createRule(jobName, {
  isAsync: true,
})

export const createJobValidator = vine.create(
  vine.object({
    jobName: vine.string().trim().maxLength(128).jobName(),
    jobParams: vine.object({}).allowUnknownProperties(),
    dueDate: vine
      .date({
        formats: ['iso8601'],
      })
      .optional()
      .transform((value: Date) => {
        return value ? DateTime.fromJSDate(value).startOf('minute') : null
      }),
  })
)
