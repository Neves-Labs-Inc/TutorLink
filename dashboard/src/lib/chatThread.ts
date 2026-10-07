import axios from 'axios'
import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type {
  Conversation,
  ConversationDetail,
  FlagReason,
  Message,
  MessageAuthorKind,
  MessageStatus,
} from '@/lib/queries/conversations'
import type { Page } from '@/lib/queries/page'

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

const FAILED_ANNOUNCEMENT = 'A message failed to send.'
const NO_BREAK_SPACE = '\u00A0'

// Screen readers only speak a live region when its text changes, so every other failure carries a
// trailing no-break space: each one is announced, with the same spoken words.
export const failedAnnouncement = (failedCount: number): string => {
  if (failedCount === 0) return ''

  return failedCount % 2 === 0 ? `${FAILED_ANNOUNCEMENT}${NO_BREAK_SPACE}` : FAILED_ANNOUNCEMENT
}

// The send the socket refused stays on screen as "Failed to send", so the unsent text can still
// be read and copied.
export const markMessagesFailed = (thread: Message[], messageIds: ReadonlySet<string>): Message[] =>
  thread.map((message) => (messageIds.has(message.id) ? { ...message, status: 'failed' } : message))

// The socket refusing a send as window_closed only holds while the Guardian's last message is the
// one it was refused against: a newer message reopens the window by itself.
export type SocketClosedFlag = { lastClientMessageAt: string | null }

export const socketSaysClosed = (
  flag: SocketClosedFlag | null,
  detail: Pick<ConversationDetail, 'last_client_message_at'>,
): boolean => flag !== null && flag.lastClientMessageAt === detail.last_client_message_at

// Long enough for a target that mounts a render or two later; short enough that a target which
// never appears can't pull focus away from whatever the user moved on to.
const FOCUS_REQUEST_TTL_MS = 1_000

// Selectors tried in order once a change unmounts or disables the focused element.
export type FocusRequest = { targets: string[]; expiresAt: number }

export const focusRequest = (targets: string[], now: number): FocusRequest => ({
  targets,
  expiresAt: now + FOCUS_REQUEST_TTL_MS,
})

// Where focus sits: on <body>, inside a dialog (`state` is Radix's data-state, null for a
// hand-rolled one like the mobile nav), or on a control in the page.
export type FocusPlace = { kind: 'body' } | { kind: 'dialog'; state: string | null } | { kind: 'page' }

// Focus on <body> was lost; focus in a closing dialog is about to be. An open dialog or sheet keeps it.
export const isFocusAdrift = (place: FocusPlace): boolean =>
  place.kind === 'body' || (place.kind === 'dialog' && place.state === 'closed')

// A Take over, Transfer or Retry the API refused. Its detail refetch may swap the refused control
// for another, so focus follows whichever control the fresh page offers.
export type RefusedAction = { kind: 'takeover' } | { kind: 'transfer' } | { kind: 'retry'; messageId: string }

// The closed-window line first: it is what a stale page most often refetches into.
const REFUSAL_FOCUS_TARGETS = [
  '[data-takeover-closed]',
  '[data-transfer]',
  '[data-takeover]:not([disabled])',
  '[data-hand-back]',
]

// A refused Retry that is still offered keeps focus, so the user can try it again.
export const refusalFocusTarget = <T>(
  refused: RefusedAction,
  find: (selector: string) => T | null,
): T | null => {
  const ownTargets = refused.kind === 'retry' ? [`[data-retry="${refused.messageId}"]:not([disabled])`] : []

  return [...ownTargets, ...REFUSAL_FOCUS_TARGETS].map(find).find((found) => found !== null) ?? null
}

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
  author: { id: authorId, display_name: authorDisplayName },
  body,
  status: 'queued',
  created_at: new Date().toISOString(),
  system_kind: null,
  error_code: null,
  reminder_child_names: null,
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

export const canTransfer = isHeldByOtherAdmin

export const TAKEOVER_CLOSED_NOTICE =
  "Window closed: take over is only possible within 24 hours of the Guardian's last message."

type WindowState = Pick<ConversationDetail, 'is_window_open'>

// The API refuses a takeover or transfer outside the Guardian's 24-hour window.
export const isTakeoverOffered = (detail: WindowState): boolean => detail.is_window_open

export const isTransferOffered = (detail: WindowState): boolean => detail.is_window_open

export const takeoverClosedNotice = (detail: WindowState): string | null =>
  detail.is_window_open ? null : TAKEOVER_CLOSED_NOTICE

export const joinNames = (names: string[]): string => {
  let joined: string

  if (names.length <= 1) {
    joined = names.join('')
  } else {
    joined = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  }
  return joined
}

const MS_PER_HOUR = 3_600_000
const HOURS_PER_DAY = 24
const DAYS_SWITCH_HOURS = 48

export const lastWroteAgo = (iso: string, now: Date): string => {
  const hours = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / MS_PER_HOUR))

  if (hours < DAYS_SWITCH_HOURS) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`

  return `${Math.floor(hours / HOURS_PER_DAY)} days ago`
}

const WINDOW_RULE = 'WhatsApp only allows replies within 24 hours of their last message.'

export const composerClosedNotice = (
  detail: Pick<
    ConversationDetail,
    'is_window_open' | 'last_client_message_at' | 'guardian' | 'phone_number'
  >,
  now: Date,
  socketSaidClosed: boolean,
): string | null => {
  if (detail.is_window_open && !socketSaidClosed) return null

  const guardian = detail.guardian?.name ?? detail.phone_number
  const lastWrote =
    detail.last_client_message_at === null
      ? `${guardian} hasn't written yet.`
      : `${guardian} last wrote ${lastWroteAgo(detail.last_client_message_at, now)}.`

  return `${lastWrote} ${WINDOW_RULE}`
}

export const OTHER_HOLDER_FALLBACK = 'another Staff member'
const OTHER_HOLDER_FALLBACK_OPENING = 'Another Staff member'

// A null holder is one whose name we don't have. Names stay exactly as written; only the
// fallback gets a capital to open the sentence.
export const transferConfirmBody = (holder: string | null, me: string | null): string => {
  const opening = holder ?? OTHER_HOLDER_FALLBACK_OPENING
  const mention = holder ?? OTHER_HOLDER_FALLBACK

  return `${opening} is holding this chat. Take it over${me === null ? '' : ` as ${me}`}? ${mention} can no longer reply here.`
}

export const handBackConfirmBody = (guardian: string): string =>
  `The bot starts a fresh flow, not from where this conversation left off. ${guardian} is told the booking assistant is back if they wrote in the last 24 hours.`

export type SystemLineLabel = { text: string; isFailed: boolean; canRetry: boolean }

const PROGRESS_WORDS: Partial<Record<MessageStatus, string>> = {
  queued: 'sending',
  sent: 'sent',
  delivered: 'delivered',
  read: 'read',
}

const FAILURE_REASONS: Record<string, string> = {
  template_not_approved: 'template not approved',
  window_closed: 'window closed',
}

const failureReason = (errorCode: string | null): string =>
  errorCode === null ? '' : ` (${FAILURE_REASONS[errorCode] ?? `error ${errorCode}`})`

const NOTICE_NAME_FALLBACK = 'Staff'

const NOTICE_PROGRESS: Partial<Record<MessageStatus, string>> = {
  queued: 'sending notice',
  sent: 'notice sent',
  delivered: 'delivered',
  read: 'read',
}

const noticeProgress = (status: MessageStatus): string => NOTICE_PROGRESS[status] ?? 'notice sent'

export const systemLineLabel = (
  message: Pick<Message, 'system_kind' | 'status' | 'error_code' | 'reminder_child_names' | 'author' | 'body'>,
  isWindowOpen: boolean,
): SystemLineLabel => {
  const isFailed = message.status === 'failed'
  const reason = failureReason(message.error_code)
  const progress = PROGRESS_WORDS[message.status] ?? 'sent'
  const names = joinNames(message.reminder_child_names ?? [])
  const name = message.author === null ? NOTICE_NAME_FALLBACK : message.author.display_name
  let text = message.body
  let canRetry = false

  if (message.system_kind === 'takeover_notice' || message.system_kind === 'transfer_notice') {
    const failedLabel =
      message.system_kind === 'takeover_notice' ? 'Takeover notice' : 'Transfer notice'

    text = isFailed
      ? `${failedLabel} not delivered${reason}`
      : `${name} joined the chat · ${noticeProgress(message.status)}`
    // The API refuses a retry outside the window too.
    canRetry = isFailed && isWindowOpen
  } else if (message.system_kind === 'handback_notice') {
    if (!isFailed) {
      text = `Hand-back notice ${progress}`
    } else if (message.error_code === 'window_closed') {
      text = 'Hand-back notice not sent (window closed)'
    } else {
      text = `Hand-back notice not delivered${reason}`
    }
  } else if (message.system_kind === 'booking_reminder') {
    text = isFailed
      ? `Weekly reminder not delivered${names === '' ? '' : `: ${names}`}${reason}`
      : `Weekly reminder sent${names === '' ? '' : `: ${names}`} · ${progress}`
  } else if (message.system_kind === 'consent_notice') {
    text = isFailed
      ? `Reminder setting confirmation not delivered${reason}`
      : `Reminder setting confirmed to Guardian · ${progress}`
  }

  return { text, isFailed, canRetry }
}
