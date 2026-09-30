import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { refreshSession } from '@/lib/api'
import type { Conversation, Message } from '@/lib/queries/conversations'
import { useAuthStore } from '@/stores/authStore'

const STREAM_PATH = '/api/conversations/stream'
const INITIAL_BACKOFF_MS = 1000
const MAX_BACKOFF_MS = 30000

export type ConversationStreamStatus = 'connecting' | 'connected' | 'disconnected'

export type MessageCreatedFrame = {
  message: Message
  conversation_id: string
  client_message_id?: string
}

type ClientFrame =
  | { type: 'auth'; access_token: string }
  | { type: 'send'; conversation_id: string; body: string; client_message_id: string }

type ServerFrame =
  | { type: 'ready' }
  | ({ type: 'message.created' } & MessageCreatedFrame)
  | { type: 'conversation.updated'; conversation: Conversation }
  | { type: 'error'; detail: string }

export type ConversationStreamListener = {
  onStatusChange: (status: ConversationStreamStatus) => void
  onError: (detail: string) => void
  onMessageCreated: (frame: MessageCreatedFrame) => void
  onConversationUpdated: (conversation: Conversation) => void
}

export type ConversationStreamDeps = {
  url: string
  createSocket: (url: string) => WebSocket
  getAccessToken: () => string | null
  refreshAccessToken: () => Promise<string>
  invalidateConversations: () => void
}

export type UseConversationStreamHandlers = {
  onMessageCreated?: (frame: MessageCreatedFrame) => void
  onConversationUpdated?: (conversation: Conversation) => void
}

// The socket is shared by every mounted view (`api-design.md:1608-1611`): one connection per
// admin session, not one per open thread. `ConversationStreamClient` holds that one connection
// and hands it out to whoever subscribes; the last unsubscribe tears it down.
export class ConversationStreamClient {
  private readonly deps: ConversationStreamDeps
  private readonly listeners = new Set<ConversationStreamListener>()
  private socket: WebSocket | null = null
  private ready = false
  private stopped = true
  private backoffMs = INITIAL_BACKOFF_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  constructor(deps: ConversationStreamDeps) {
    this.deps = deps
  }

  subscribe = (listener: ConversationStreamListener): (() => void) => {
    this.listeners.add(listener)

    if (this.stopped) {
      this.stopped = false
      this.openSocket()
    } else {
      listener.onStatusChange(this.ready ? 'connected' : 'connecting')
    }

    return () => {
      this.listeners.delete(listener)

      if (this.listeners.size === 0) {
        this.stop()
      }
    }
  }

  send = (conversationId: string, body: string, clientMessageId: string) => {
    if (this.socket !== null && this.ready) {
      this.sendFrame({
        type: 'send',
        conversation_id: conversationId,
        body,
        client_message_id: clientMessageId,
      })
    }
  }

  private stop = () => {
    this.stopped = true

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.socket?.close()
    this.socket = null
    this.ready = false
  }

  private sendFrame = (frame: ClientFrame) => {
    this.socket?.send(JSON.stringify(frame))
  }

  private openSocket = () => {
    this.notifyStatus('connecting')
    this.ready = false

    const socket = this.deps.createSocket(this.deps.url)
    this.socket = socket

    socket.addEventListener('open', this.handleOpen)
    socket.addEventListener('message', this.handleMessage)
    socket.addEventListener('close', this.handleClose)
  }

  private handleOpen = () => {
    const accessToken = this.deps.getAccessToken()

    if (accessToken !== null) {
      this.sendFrame({ type: 'auth', access_token: accessToken })
    }
  }

  private handleMessage = (event: MessageEvent) => {
    const frame = JSON.parse(event.data) as ServerFrame

    if (frame.type === 'ready') {
      this.ready = true
      this.backoffMs = INITIAL_BACKOFF_MS
      this.notifyStatus('connected')
      this.deps.invalidateConversations()
    } else if (frame.type === 'message.created') {
      for (const listener of this.listeners) listener.onMessageCreated(frame)
    } else if (frame.type === 'conversation.updated') {
      for (const listener of this.listeners) listener.onConversationUpdated(frame.conversation)
    } else {
      for (const listener of this.listeners) listener.onError(frame.detail)
    }
  }

  // A close carrying 1008 means the access token the first frame carried has expired
  // (`api-design.md:1636-1638`); every other close is a dropped connection and gets the
  // backoff schedule instead of an immediate retry.
  private handleClose = (event: CloseEvent) => {
    this.ready = false
    this.socket = null
    this.notifyStatus('disconnected')

    if (!this.stopped) {
      if (event.code === 1008) {
        this.deps.refreshAccessToken().then(this.openSocket, this.openSocket)
      } else {
        this.scheduleReconnect()
      }
    }
  }

  private scheduleReconnect = () => {
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.openSocket()
    }, delay)
  }

  private notifyStatus = (status: ConversationStreamStatus) => {
    for (const listener of this.listeners) listener.onStatusChange(status)
  }
}

let sharedClient: ConversationStreamClient | null = null

const streamUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'

  return `${protocol}//${window.location.host}${STREAM_PATH}`
}

const getSharedClient = (queryClient: QueryClient): ConversationStreamClient => {
  sharedClient ??= new ConversationStreamClient({
    url: streamUrl(),
    createSocket: (url) => new WebSocket(url),
    getAccessToken: () => useAuthStore.getState().accessToken,
    refreshAccessToken: refreshSession,
    invalidateConversations: () => queryClient.invalidateQueries({ queryKey: ['conversations'] }),
  })

  return sharedClient
}

export const useConversationStream = (handlers: UseConversationStreamHandlers = {}) => {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<ConversationStreamStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const client = getSharedClient(queryClient)
    const unsubscribe = client.subscribe({
      onStatusChange: setStatus,
      onError: setError,
      onMessageCreated: (frame) => handlersRef.current.onMessageCreated?.(frame),
      onConversationUpdated: (conversation) =>
        handlersRef.current.onConversationUpdated?.(conversation),
    })

    return unsubscribe
  }, [queryClient])

  const send = useCallback((conversationId: string, body: string, clientMessageId: string) => {
    sharedClient?.send(conversationId, body, clientMessageId)
  }, [])

  return { status, error, send }
}
