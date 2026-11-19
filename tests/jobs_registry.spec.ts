import { mkdir, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from '@japa/runner'
import JobsRegistry from '../src/core/jobs_registry.js'
import { getApp } from './helpers/app.js'
import SendReport from './helpers/send_report_job.js'

const jobsDir = fileURLToPath(new URL('../app/jobs/', import.meta.url))

test.group('Jobs registry', (group) => {
  group.each.setup(async () => {
    await rm(jobsDir, { recursive: true, force: true })
  })

  group.each.teardown(async () => {
    await rm(jobsDir, { recursive: true, force: true })
  })

  test('registers a job once and looks it up by name', async ({ assert }) => {
    const registry = new JobsRegistry(getApp())
    assert.deepEqual(await registry.getJobs(), {})
    assert.isFalse(await registry.hasJob('SendReport'))
    assert.isUndefined(await registry.getJob('SendReport'))

    await registry.registerJob(SendReport)
    await registry.registerJob(SendReport)

    const jobs = await registry.getJobs()
    assert.strictEqual(jobs.SendReport, SendReport)
    assert.isTrue(await registry.hasJob('SendReport'))
    assert.strictEqual(await registry.getJob('SendReport'), SendReport)
    assert.strictEqual(await registry.getJobs(), jobs)
  })

  test('loads job files and skips helpers, declarations, and other files', async ({ assert }) => {
    await mkdir(jobsDir, { recursive: true })
    await writeFile(
      `${jobsDir}/ping_job.ts`,
      `import Job from '../../src/job.js'
export default class PingJob extends Job {
  async run() {}
}
`
    )
    await writeFile(
      `${jobsDir}/js_job.js`,
      `import Job from '../../src/job.js'
export default class JsJob extends Job {
  async run() {}
}
`
    )
    await writeFile(`${jobsDir}/_skip.ts`, 'export default class Skip {}\n')
    await writeFile(`${jobsDir}/notes.txt`, 'not a job\n')
    await writeFile(`${jobsDir}/types.d.ts`, 'export type Marker = string\n')

    const jobs = await new JobsRegistry(getApp()).getJobs()
    assert.deepEqual(Object.keys(jobs).sort(), ['JsJob', 'PingJob'])
  })

  test('rejects a file that does not export a job', async ({ assert }) => {
    await mkdir(jobsDir, { recursive: true })
    await writeFile(`${jobsDir}/bad_job.ts`, 'export default class BadJob {}\n')

    try {
      await new JobsRegistry(getApp()).getJobs()
      assert.fail('Expected the registry to reject the file')
    } catch (error) {
      assert.include((error as Error).message, 'does not export a Job')
    }
  })
})
