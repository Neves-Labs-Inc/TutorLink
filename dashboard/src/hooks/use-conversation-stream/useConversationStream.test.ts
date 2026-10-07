import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { ConversationStreamClient, type ConversationStreamListener } from './useConversationStream'

type FakeWebSocketEvent = { code?: number; data?: string }

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  readonly url: string
  sent: string[] = []
  private readonly listeners = new Map<string, ((event: FakeWebSocketEvent) => void)[]>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, handler: (event: FakeWebSocketEvent) => void) {
    const existing = this.listeners.get(type) ?? []
    existing.push(handler)
    this.listeners.set(type, existing)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.emit('close', { code: 1000 })
  }

  emit(type: string, event: FakeWebSocketEvent) {
    for (const handler of this.listeners.get(type) ?? []) handler(event)
  }
}

const readyFrame = { data: JSON.stringify({ type: 'ready' }) }

const noopListener = (): ConversationStreamListener => ({
  onStatusChange: vi.fn(),
  onError: vi.fn(),
  onMessageCreated: vi.fn(),
  onConversationUpdated: vi.fn(),
  onMessageUpdated: vi.fn(),
})

const createClient = () => {
  let accessToken = 'token-1'
  const invalidateConversations = vi.fn()
  const refreshAccessToken = vi.fn(async () => {
    accessToken = 'token-2'

    return accessToken
  })
  const client = new ConversationStreamClient({
    url: 'ws://test/api/conversations/stream',
    createSocket: (url) => new FakeWebSocket(url) as unknown as WebSocket,
    getAccessToken: () => accessToken,
    refreshAccessToken,
    invalidateConversations,
  })

  return { client, invalidateConversations, refreshAccessToken }
}

beforeEach(() => {
  FakeWebSocket.instances = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ConversationStreamClient', () => {
  it('sends the auth frame first, and only once the socket has opened', () => {
    const { client } = createClient()
    client.subscribe(noopListener())
    const socket = FakeWebSocket.instances[0]

    expect(socket.sent).toHaveLength(0)

    socket.emit('open', {})

    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'auth', access_token: 'token-1' })
  })

  it('refuses to send anything else before the server replies ready', () => {
    const { client } = createClient()
    client.subscribe(noopListener())
    const socket = FakeWebSocket.instances[0]

    socket.emit('open', {})
    client.send('conversation-1', 'hello', 'client-message-1')
    expect(socket.sent).toHaveLength(1)

    socket.emit('message', readyFrame)
    client.send('conversation-1', 'hello', 'client-message-1')

    expect(socket.sent).toHaveLength(2)
    expect(JSON.parse(socket.sent[1])).toEqual({
      type: 'send',
      conversation_id: 'conversation-1',
      body: 'hello',
      client_message_id: 'client-message-1',
    })
  })

  it('refreshes the access token and reconnects with it on a 1008 close', async () => {
    const { client, refreshAccessToken } = createClient()
    client.subscribe(noopListener())
    const firstSocket = FakeWebSocket.instances[0]

    firstSocket.emit('open', {})
    firstSocket.emit('message', readyFrame)
    firstSocket.emit('close', { code: 1008 })

    expect(refreshAccessToken).toHaveBeenCalledOnce()
    await Promise.resolve()
    await Promise.resolve()

    expect(FakeWebSocket.instances).toHaveLength(2)
    const secondSocket = FakeWebSocket.instances[1]
    secondSocket.emit('open', {})

    expect(JSON.parse(secondSocket.sent[0])).toEqual({ type: 'auth', access_token: 'token-2' })
  })

  it('backs off exponentially between reconnect attempts, capped at 30s', () => {
    vi.useFakeTimers()
    const { client } = createClient()
    client.subscribe(noopListener())

    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000]

    for (const delay of delays) {
      const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
      const countBefore = FakeWebSocket.instances.length
      socket.emit('close', { code: 1000 })

      vi.advanceTimersByTime(delay - 1)
      expect(FakeWebSocket.instances).toHaveLength(countBefore)

      vi.advanceTimersByTime(1)
      expect(FakeWebSocket.instances).toHaveLength(countBefore + 1)
    }
  })

  it('invalidates the conversations queries on every connect and reconnect', () => {
    vi.useFakeTimers()
    const { client, invalidateConversations } = createClient()
    client.subscribe(noopListener())
    let socket = FakeWebSocket.instances[0]

    socket.emit('open', {})
    socket.emit('message', readyFrame)
    expect(invalidateConversations).toHaveBeenCalledTimes(1)

    socket.emit('close', { code: 1000 })
    vi.advanceTimersByTime(1000)
    socket = FakeWebSocket.instances[1]
    socket.emit('open', {})
    socket.emit('message', readyFrame)

    expect(invalidateConversations).toHaveBeenCalledTimes(2)
  })

  it('surfaces error frames to every subscriber', () => {
    const { client } = createClient()
    const listener = noopListener()
    client.subscribe(listener)
    const socket = FakeWebSocket.instances[0]

    socket.emit('message', { data: JSON.stringify({ type: 'error', detail: 'boom' }) })

    expect(listener.onError).toHaveBeenCalledWith('boom', undefined)
  })

  it('passes an error frame code along', () => {
    const { client } = createClient()
    const listener = noopListener()
    client.subscribe(listener)
    const socket = FakeWebSocket.instances[0]

    socket.emit('message', {
      data: JSON.stringify({ type: 'error', detail: 'closed', code: 'window_closed' }),
    })

    expect(listener.onError).toHaveBeenCalledWith('closed', 'window_closed')
  })

  it('hands a message.updated frame to onMessageUpdated and to no other listener method', () => {
    const { client } = createClient()
    const listener = noopListener()
    client.subscribe(listener)
    const socket = FakeWebSocket.instances[0]
    const frame = {
      type: 'message.updated',
      conversation_id: 'conversation-1',
      message: {
        id: 'message-1',
        author_kind: 'admin',
        author: { id: 'admin-1', email: 'admin@example.com' },
        body: 'See you at 4pm.',
        status: 'delivered',
        created_at: '2026-10-01T14:02:00Z',
      },
    }

    socket.emit('message', { data: JSON.stringify(frame) })

    expect(listener.onMessageUpdated).toHaveBeenCalledWith(frame)
    expect(listener.onMessageCreated).not.toHaveBeenCalled()
    expect(listener.onError).not.toHaveBeenCalled()
  })

  it('still hands a message.created frame to onMessageCreated only', () => {
    const { client } = createClient()
    const listener = noopListener()
    client.subscribe(listener)
    const socket = FakeWebSocket.instances[0]
    const frame = {
      type: 'message.created',
      conversation_id: 'conversation-1',
      message: {
        id: 'message-1',
        author_kind: 'client',
        author: null,
        body: 'hello',
        status: 'received',
        created_at: '2026-10-01T14:02:00Z',
      },
    }

    socket.emit('message', { data: JSON.stringify(frame) })

    expect(listener.onMessageCreated).toHaveBeenCalledWith(frame)
    expect(listener.onMessageUpdated).not.toHaveBeenCalled()
  })
})
