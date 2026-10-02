import axios from 'axios'

import { api } from '@/lib/api'
import type {
  Conversation,
  ConversationDetail,
  FlagReason,
  Message,
  MessageAuthorKind,
} from '@/lib/queries/conversations'

export type ThreadAlignment = 'start' | 'end'

export const takeoverConversation = async (conversationId: string): Promise<ConversationDetail> => {
  const response = await api.post<ConversationDetail>(
    `/api/conversations/${conversationId}/takeover`,
  )

  return response.data
}

export const releaseConversation = async (conversationId: string): Promise<ConversationDetail> => {
  const response = await api.delete<ConversationDetail>(
    `/api/conversations/${conversationId}/takeover`,
  )

  return response.data
}

export const markConversationRead = async (conversationId: string): Promise<ConversationDetail> => {
  const response = await api.post<ConversationDetail>(`/api/conversations/${conversationId}/read`)

  return response.data
}

// `flaggedAt` is sent exactly as received from `ConversationRead.flagged_at`, never through
// `new Date(…)` or `toISOString()`: JavaScript dates hold milliseconds and the server compares
// microseconds, so a re-serialised token always mismatches.
export const markConversationHandled = async (
  conversationId: string,
  flaggedAt: string,
): Promise<ConversationDetail> => {
  const response = await api.post<ConversationDetail>(
    `/api/conversations/${conversationId}/handled`,
    { flagged_at: flaggedAt },
  )

  return response.data
}

const HANDLEABLE_FLAG_REASONS: readonly FlagReason[] = [
  'stuck',
  'parse_error',
  'guardian_link_request',
  'booking_request',
  'question',
]

export const canMarkHandled = (
  conversation: Pick<ConversationDetail, 'flag_reason' | 'flagged_at'>,
): boolean =>
  conversation.flag_reason !== null &&
  conversation.flagged_at !== null &&
  HANDLEABLE_FLAG_REASONS.includes(conversation.flag_reason)

export const isFlagChangedError = (error: unknown): boolean =>
  axios.isAxiosError(error) && error.response?.status === 409

export const messageAlignment = (authorKind: MessageAuthorKind): ThreadAlignment =>
  authorKind === 'client' ? 'start' : 'end'

const ADMIN_STATUS_LABELS: Partial<Record<Message['status'], string>> = {
  queued: 'Sending…',
  sent: 'Sent',
  delivered: 'Delivered',
  failed: 'Failed to send',
}

// Delivery progress only means something on an admin's own outbound message. A bot reply is
// recorded `sent` forever by design (amendment P7-3, `api-design.md:527-534`) and must never
// read as pending or failed, and a client message carries no admin-side delivery state at all —
// both render nothing here.
export const messageStatusLabel = (
  message: Pick<Message, 'author_kind' | 'status'>,
): string | null => {
  if (message.author_kind !== 'admin') return null

  return ADMIN_STATUS_LABELS[message.status] ?? null
}

// A `message.updated` frame only ever changes a message already on screen; an id that isn't
// there belongs to a page not loaded yet, and the refetch will carry it. Returning the same
// array when nothing matched lets React Query skip the re-render.
export const applyMessageUpdate = (thread: Message[], updated: Message): Message[] => {
  if (!thread.some((message) => message.id === updated.id)) return thread

  return thread.map((message) => (message.id === updated.id ? updated : message))
}

// Each fetched page is newest-first (`api-design.md:1531`) and `pages` runs from the newest
// window (index 0) to the oldest window fetched last. Reversing each page and then the page
// order turns that into reading order; de-duplicating by id covers a page re-fetched after a
// reconnect that overlaps one already merged in.
export const mergeMessagePages = (pages: Message[][]): Message[] => {
  const seen = new Set<string>()
  const merged: Message[] = []

  for (let pageIndex = pages.length - 1; pageIndex >= 0; pageIndex -= 1) {
    const page = pages[pageIndex]

    for (let itemIndex = page.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const message = page[itemIndex]

      if (!seen.has(message.id)) {
        seen.add(message.id)
        merged.push(message)
      }
    }
  }

  return merged
}

// An optimistic bubble is keyed by its own `client_message_id` until the `message.created` echo
// carries the same id (`api-design.md:1691-1695`). Reconciling in place, rather than appending
// the echo, is what keeps a resend after a reconnect from rendering twice.
export const reconcileLiveMessage = (
  thread: Message[],
  incoming: Message,
  clientMessageId?: string,
): Message[] => {
  const matchIndex = thread.findIndex(
    (message) =>
      message.id === incoming.id || (clientMessageId !== undefined && message.id === clientMessageId),
  )
  let next: Message[]

  if (matchIndex === -1) {
    next = [...thread, incoming]
  } else {
    next = [...thread]
    next[matchIndex] = incoming
  }

  return next
}

export const optimisticMessage = (
  clientMessageId: string,
  body: string,
  authorId: string,
  authorEmail: string,
): Message => ({
  id: clientMessageId,
  author_kind: 'admin',
  author: { id: authorId, email: authorEmail },
  body,
  status: 'queued',
  created_at: new Date().toISOString(),
})

export const isHeldByAdmin = (
  conversation: Pick<Conversation, 'status' | 'taken_over_by'>,
  userId: string,
): boolean => conversation.status === 'human' && conversation.taken_over_by?.id === userId

export const isHeldByOtherAdmin = (
  conversation: Pick<Conversation, 'status' | 'taken_over_by'>,
  userId: string,
): boolean =>
  conversation.status === 'human' &&
  conversation.taken_over_by !== null &&
  conversation.taken_over_by.id !== userId

// The oldest message on screen is the `before` marker paging back needs
// (`api-design.md:1531-1537`); an empty thread has nothing to page back from.
export const oldestCreatedAt = (thread: Message[]): string | null =>
  thread.length === 0 ? null : thread[0].created_at

export const formatMessageTimestamp = (iso: string): string =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
