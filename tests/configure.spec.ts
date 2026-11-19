import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from '@japa/runner'
import Configure from '@adonisjs/core/commands/configure'
import type { ApplicationService } from '@adonisjs/core/types'
import { IgnitorFactory } from '@adonisjs/core/factories'
import { restoreTestApp } from './helpers/app.js'

test.group('configure', () => {
  test('registers the package and publishes the config and migration', async ({ assert }) => {
    const host = await createHostApp()
    try {
      const command = await configureHost(host)
      const rcFile = await readFile(join(host.directory, 'adonisrc.ts'), 'utf8')
      const configFile = await readFile(join(host.directory, 'config', 'jobs.ts'), 'utf8')
      const migrations = await readdir(join(host.directory, 'database', 'migrations'))

      assert.notEqual(command.exitCode, 1)
      assert.include(rcFile, `() => import('@ifullgaz/adonis-jobs/provider')`)
      assert.include(rcFile, `() => import('@ifullgaz/adonis-jobs/commands')`)
      assert.include(configFile, 'JOB_QUEUE_BUS_ENABLED')
      assert.include(configFile, 'job-queue:process')
      assert.lengthOf(migrations, 1)
      assert.isTrue(/^\d+_create_job_queue_table\.ts$/.test(migrations[0]))
      const migration = await readFile(
        join(host.directory, 'database', 'migrations', migrations[0]),
        'utf8'
      )
      assert.include(migration, 'job_queue')
    } finally {
      await rm(host.directory, { recursive: true, force: true })
    }
  }).timeout(0)
})

async function createHostApp() {
  const root = fileURLToPath(new URL('./tmp/', import.meta.url))
  await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'app-'))
  const url = pathToFileURL(directory)
  url.pathname = `${url.pathname}/`
  await writeFile(
    join(directory, 'package.json'),
    `${JSON.stringify({ name: 'jobs-app', private: true, type: 'module' }, null, 2)}\n`
  )
  await writeFile(
    join(directory, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          skipLibCheck: true,
        },
        include: ['adonisrc.ts'],
      },
      null,
      2
    )}\n`
  )
  await writeFile(
    join(directory, 'adonisrc.ts'),
    `import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  providers: [() => import('@adonisjs/core/providers/app_provider')],
})
`
  )
  return { directory, url }
}

async function configureHost(host: { directory: string; url: URL }) {
  let app: ApplicationService | undefined
  try {
    app = new IgnitorFactory()
      .withCoreProviders()
      .withCoreConfig()
      .create(host.url, {
        importer: (filePath) => import(filePath),
      })
      .createApp('web')
    await app.init()
    await app.boot()
    const ace = await app.container.make('ace')
    const command = await ace.create(Configure, ['@ifullgaz/adonis-jobs'])
    command.ui.switchMode('silent')
    const { configure } = await import('../configure.js')
    await configure(command)
    return command
  } finally {
    if (app) {
      await app.terminate()
    }
    restoreTestApp()
  }
}
