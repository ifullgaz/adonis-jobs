import { mkdtempSync } from 'node:fs'
import { setApp } from '@adonisjs/core/services/app'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { defineConfig } from '@adonisjs/lucid'
import type { ApplicationService } from '@adonisjs/core/types'
import type { JobQueueConfig } from '../../src/types/types.js'
import { allowSqliteQueueLocks } from './sqlite.js'
import { RecordingBus } from './recording_bus.js'

export const recordingBus = new RecordingBus()

const jobQueueConfig: JobQueueConfig = {
  bus: {
    factory: async () => recordingBus,
    enabled: false,
    channel: 'job-queue:process',
  },
}

let application: ApplicationService | undefined

export function getApp() {
  if (!application) {
    throw new Error('Test application is not booted')
  }
  return application
}

export function setBusEnabled(enabled: boolean) {
  jobQueueConfig.bus.enabled = enabled
}

export function restoreTestApp() {
  setApp(getApp())
}

export async function bootTestApp() {
  if (application) {
    return application
  }

  allowSqliteQueueLocks()
  const filename = join(mkdtempSync(join(tmpdir(), 'adonis-jobs-')), 'db.sqlite')
  application = new IgnitorFactory()
    .withCoreProviders()
    .withCoreConfig()
    .merge({
      rcFileContents: {
        providers: [
          () => import('@adonisjs/lucid/database_provider'),
          () => import('../../providers/provider.js'),
        ],
      },
      config: {
        database: defineConfig({
          connection: 'sqlite',
          connections: {
            sqlite: {
              client: 'better-sqlite3',
              connection: { filename },
              useNullAsDefault: true,
              pool: { min: 1, max: 1 },
            },
          },
        }),
        jobQueue: jobQueueConfig,
      },
    })
    .create(new URL('../../', import.meta.url), {
      importer: (filePath) => import(filePath),
    })
    .createApp('test')

  await application.init()
  await application.boot()
  application.config.set('jobQueue', jobQueueConfig)
  await import('@adonisjs/lucid/services/db')
  await createSchema()
  return application
}

async function createSchema() {
  const database = await getApp().container.make('lucid.db')
  await database.connection().schema.createTable('job_queue', (table) => {
    table.bigIncrements('id').notNullable()
    table.string('job_name', 128).notNullable()
    table.json('job_params').notNullable()
    table.tinyint('status').notNullable().defaultTo(0)
    table.timestamp('due_date').nullable()
    table.timestamp('start_date').nullable()
    table.timestamp('end_date').nullable()
    table.json('reason').nullable()
    table.timestamp('created_at')
    table.timestamp('updated_at')
    table.index(['status', 'end_date'])
  })
}

export async function resetQueue() {
  recordingBus.reset()
  setBusEnabled(false)
  const database = await getApp().container.make('lucid.db')
  await database.connection().from('job_queue').delete()
}

export async function shutdownTestApp() {
  if (!application) {
    return
  }
  await application.terminate()
  application = undefined
}
