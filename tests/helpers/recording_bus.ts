import type { BusContract, Serializable, SubscribeHandler } from '../../src/types/types.js'

export type PublishedMessage = {
  channel: string
  message: Serializable
}

export class RecordingBus implements BusContract {
  published: PublishedMessage[] = []

  #handlers = new Map<string, Array<SubscribeHandler<Serializable>>>()

  prefixedKey(key: string) {
    return `jobs:${key}`
  }

  async publish(channel: string, message: Serializable) {
    this.published.push({ channel, message })
    const handlers = [...(this.#handlers.get(channel) ?? [])]
    for (const handler of handlers) {
      await handler(message)
    }
    return true
  }

  async subscribe<T extends Serializable>(channel: string, handler: SubscribeHandler<T>) {
    const handlers = this.#handlers.get(channel) ?? []
    handlers.push(handler as SubscribeHandler<Serializable>)
    this.#handlers.set(channel, handlers)
  }

  async unsubscribe(channel: string) {
    this.#handlers.delete(channel)
  }

  reset() {
    this.published = []
    this.#handlers.clear()
  }
}
