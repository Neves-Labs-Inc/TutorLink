import axios from 'axios'
import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { ConversationDetail, Message } from '@/lib/queries/conversations'
import type { Page } from '@/lib/queries/page'

export const takeoverConversation = async (conversationId: string): Promise<ConversationDetail> => {
  const response = await api.post<ConversationDetail>(
    `/api/conversations/${encodeURIComponent(conversationId)}/takeover`,
  )

  return response.data
}

export const markConversationRead = async (conversationId: string): Promise<ConversationDetail> => {
  const response = await api.post<ConversationDetail>(`/api/conversations/${encodeURIComponent(conversationId)}/read`)

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
    `/api/conversations/${encodeURIComponent(conversationId)}/handled`,
    { flagged_at: flaggedAt },
  )

  return response.data
}

export const undoConversationHandled = async (conversationId: string): Promise<ConversationDetail> => {
  const response = await api.post<ConversationDetail>(
    `/api/conversations/${encodeURIComponent(conversationId)}/handled/undo`,
  )

  return response.data
}

export const isFlagChangedError = (error: unknown): boolean =>
  axios.isAxiosError(error) && error.response?.status === 409

// A `message.updated` frame only ever changes a message already on screen; an id that isn't
// there belongs to a page not loaded yet, and the refetch will carry it. Returning the same
// array when nothing matched lets React Query skip the re-render.
export const applyMessageUpdate = (thread: Message[], updated: Message): Message[] => {
  if (!thread.some((message) => message.id === updated.id)) return thread

  return thread.map((message) => (message.id === updated.id ? updated : message))
}

// A messages fetch already in flight may have read the row before this change committed and would
// overwrite it on landing, so it is cancelled first and fetched again once the change is in place.
export const applyMessageToPages = async (
  queryClient: QueryClient,
  queryKey: QueryKey,
  updated: Message,
): Promise<void> => {
  const wasFetching = queryClient.isFetching({ queryKey }) > 0

  await queryClient.cancelQueries({ queryKey })
  queryClient.setQueriesData<Page<Message>>({ queryKey }, (page) => {
    if (page === undefined) return page

    const items = applyMessageUpdate(page.items, updated)

    return items === page.items ? page : { ...page, items }
  })
  if (wasFetching) {
    queryClient.invalidateQueries({ queryKey })
  }
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

// Pending messages (optimistic bubbles, echoes, socket-refused sends) sit on top of the pages, but
// once a page carries the row the server copy wins: it is the one a reconnect refetch corrects.
export const assembleThread = (paged: Message[], pending: Message[]): Message[] => {
  const pagedIds = new Set(paged.map((message) => message.id))

  return pending
    .filter((message) => !pagedIds.has(message.id))
    .reduce((thread, message) => reconcileLiveMessage(thread, message), paged)
}

// Long enough for a target that mounts a render or two later; short enough that a target which
// never appears can't pull focus away from whatever the user moved on to.
const FOCUS_REQUEST_TTL_MS = 1_000

// Selectors tried in order once a change unmounts or disables the focused element.
export type FocusRequest = { targets: string[]; expiresAt: number }

export const focusRequest = (targets: string[], now: number): FocusRequest => ({
  targets,
  expiresAt: now + FOCUS_REQUEST_TTL_MS,
})

export const isFocusRequestLive = (request: FocusRequest | null, now: number): boolean =>
  request !== null && now < request.expiresAt

export const optimisticMessage = (
  clientMessageId: string,
  body: string,
  authorId: string,
  authorDisplayName: string,
): Message => ({
  id: clientMessageId,
  author_kind: 'admin',
  author: { id: authorId, name: authorDisplayName },
  body,
  status: 'queued',
  created_at: new Date().toISOString(),
  system_kind: null,
  error_code: null,
  reminder_child_names: null,
})

// The oldest message on screen is the `before` marker paging back needs
// (`api-design.md:1531-1537`); an empty thread has nothing to page back from.
export const oldestCreatedAt = (thread: Message[]): string | null =>
  thread.length === 0 ? null : thread[0].created_at

export const joinNames = (names: string[]): string => {
  let joined: string

  if (names.length <= 1) {
    joined = names.join('')
  } else {
    joined = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  }
  return joined
}

export type MessageAreaState = 'loading' | 'error' | 'empty' | 'ready'

export type PageStatus = { hasData: boolean; isPending: boolean; isFetching: boolean; isError: boolean }

// `messageCount` is the assembled thread (loaded + pending/optimistic), so a pending send is content.
export const messageAreaState = (firstPage: PageStatus, messageCount: number): MessageAreaState => {
  // isPending covers a paused (offline) fetch, which is not isFetching.
  if (!firstPage.hasData && (firstPage.isPending || firstPage.isFetching)) return 'loading'
  if (!firstPage.hasData && firstPage.isError) return 'error'
  if (firstPage.hasData && messageCount === 0) return 'empty'
  return 'ready'
}

export type OlderPageState = 'idle' | 'fetching' | 'error'

// `lastPage` is the newest cursor page, or null when only the first page is requested.
export const olderPageState = (lastPage: PageStatus | null): OlderPageState => {
  if (lastPage === null) return 'idle'
  if (lastPage.isFetching) return 'fetching'
  if (lastPage.isError && !lastPage.hasData) return 'error'
  return 'idle'
}
