import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { createJobValidator } from '../src/validators/job_queue_entry.js'
import { getApp } from './helpers/app.js'
import SendReport from './helpers/send_report_job.js'

test.group('Job validator', () => {
  test('accepts a known job and normalizes the due date', async ({ assert }) => {
    const app = getApp()
    const registry = await app.container.make('jobsRegistry')
    await registry.registerJob(SendReport)

    const withoutDueDate = await createJobValidator.validate({
      jobName: '  SendReport  ',
      jobParams: { reportId: 1, nested: { ok: true } },
    })
    assert.equal(withoutDueDate.jobName, 'SendReport')
    assert.deepEqual(withoutDueDate.jobParams, { reportId: 1, nested: { ok: true } })
    assert.isUndefined(withoutDueDate.dueDate)

    const withDueDate = await createJobValidator.validate({
      jobName: 'SendReport',
      jobParams: {},
      dueDate: '2026-11-18T10:15:45.000Z',
    })
    const dueDate = withDueDate.dueDate
    if (!dueDate) {
      throw new Error('Expected the due date to be set')
    }
    const expected = DateTime.fromJSDate(new Date('2026-11-18T10:15:45.000Z')).startOf('minute')
    assert.equal(dueDate.toUnixInteger(), expected.toUnixInteger())
    assert.equal(dueDate.second, 0)
  })

  test('rejects an unknown job name', async ({ assert }) => {
    try {
      await createJobValidator.validate({ jobName: 'MissingJob', jobParams: {} })
      assert.fail('Expected the job name to be rejected')
    } catch (error) {
      assert.include(JSON.stringify(error), 'not a valid job name')
    }
  })
})
