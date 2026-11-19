import { test } from '@japa/runner'
import { defineConfig } from '../src/define_config.js'

test.group('Package entry', () => {
  test('returns the job queue config and exports the package api', async ({ assert }) => {
    const config = {
      bus: {
        enabled: false,
        channel: 'job-queue:process',
      },
    }
    assert.strictEqual(defineConfig(config), config)

    const entry = await import('../index.js')
    assert.strictEqual(entry.defineConfig, defineConfig)
    assert.isFunction(entry.configure)
    assert.isTrue(entry.stubsRoot.endsWith('stubs'))
  })
})
