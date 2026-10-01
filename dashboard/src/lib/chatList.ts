import { formatIsoDate } from '@/lib/dates/dates'
import type {
  Conversation,
  ConversationListParams,
  ConversationStatus,
  FlagReason,
} from '@/lib/queries/conversations'

export type ConversationFilterState = {
  status: ConversationStatus | ''
  unread: boolean
  flagged: boolean
  q: string
}

export const EMPTY_FILTERS: ConversationFilterState = {
  status: '',
  unread: false,
  flagged: false,
  q: '',
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const RELATIVE_CUTOFF_MS = 7 * DAY_MS

export const conversationListParams = (
  state: ConversationFilterState,
  page: number,
  pageSize: number,
): ConversationListParams => {
  const params: ConversationListParams = { page, page_size: pageSize }

  if (state.status !== '') {
    params.status = state.status
  }
  if (state.unread) {
    params.unread = true
  }
  if (state.flagged) {
    params.flagged = true
  }

  const term = state.q.trim()

  if (term !== '') {
    params.q = term
  }

  return params
}

// `guardian` is null while intake hasn't got far enough to create one, not an error
// (`api-design.md:1417-1421`) — the phone number is what an admin reads instead.
export const conversationDisplayName = (conversation: Conversation): string =>
  conversation.guardian?.name ?? conversation.phone_number

// Only present while `status === 'human'`; naming the holder is the point of the badge.
export const conversationHolderLabel = (conversation: Conversation): string | null =>
  conversation.status === 'human' ? (conversation.taken_over_by?.email ?? null) : null

// These are routine handoffs, not the bot breaking (P7-E) — `StatusBadge` gives them a tone
// distinct from the shared destructive tone `stuck`/`parse_error` render in.
const HANDOFF_FLAG_REASONS: readonly FlagReason[] = [
  'guardian_link_request',
  'reactivation_request',
  'booking_request',
  'question',
]

export const isErrorFlag = (reason: FlagReason): boolean => !HANDOFF_FLAG_REASONS.includes(reason)

export const relativeTimeLabel = (iso: string, now: Date): string => {
  const deltaMs = now.getTime() - new Date(iso).getTime()

  if (deltaMs < MINUTE_MS) {
    return 'just now'
  }
  if (deltaMs < HOUR_MS) {
    return `${Math.floor(deltaMs / MINUTE_MS)}m ago`
  }
  if (deltaMs < DAY_MS) {
    return `${Math.floor(deltaMs / HOUR_MS)}h ago`
  }
  if (deltaMs < RELATIVE_CUTOFF_MS) {
    return `${Math.floor(deltaMs / DAY_MS)}d ago`
  }

  return formatIsoDate(iso.slice(0, 10))
}
