import { test } from '@japa/runner'
import { bus } from '../src/transports/bus.js'
import type { Serializable, SubscribeHandler } from '../src/types/types.js'
import { getApp } from './helpers/app.js'

type Published = {
  channel: string
  message: Serializable
}

class FakeConnection {
  published: Published[] = []
  unsubscribed: string[] = []
  #handlers = new Map<string, Array<SubscribeHandler<Serializable>>>()

  async publish(channel: string, message: Serializable) {
    this.published.push({ channel, message })
    const handlers = this.#handlers.get(channel) ?? []
    for (const handler of handlers) {
      await handler(message)
    }
    return true
  }

  async subscribe(channel: string, handler: SubscribeHandler<Serializable>) {
    const handlers = this.#handlers.get(channel) ?? []
    handlers.push(handler)
    this.#handlers.set(channel, handlers)
  }

  async unsubscribe(channel: string) {
    this.unsubscribed.push(channel)
    this.#handlers.delete(channel)
  }
}

test.group('Bus transport', () => {
  test('prefixes keys and forwards publish, subscribe, and unsubscribe', async ({ assert }) => {
    const app = getApp()
    const connection = new FakeConnection()
    app.config.set('bus', {
      default: 'memory',
      transports: {
        memory: { keyPrefix: 'pref:' },
      },
    })
    type LooseContainer = {
      singleton(binding: string, resolver: () => Promise<unknown>): void
    }
    const container = app.container as unknown as LooseContainer
    container.singleton('bus', async () => {
      return {
        use(transport?: string) {
          assert.equal(transport, 'memory')
          return connection
        },
      }
    })

    const transport = await bus('memory')()
    assert.equal(transport.prefixedKey('job-queue:process'), 'pref:job-queue:process')
    assert.equal(transport.prefixedKey('job-queue:process', 'memory'), 'pref:job-queue:process')

    const received: Serializable[] = []
    await transport.subscribe('pref:job-queue:process', (message) => {
      received.push(message)
    })
    assert.isTrue(await transport.publish('pref:job-queue:process', { timed: null }))
    assert.deepEqual(connection.published, [
      { channel: 'pref:job-queue:process', message: { timed: null } },
    ])
    assert.deepEqual(received, [{ timed: null }])

    await transport.unsubscribe('pref:job-queue:process')
    assert.deepEqual(connection.unsubscribed, ['pref:job-queue:process'])
  })
})
