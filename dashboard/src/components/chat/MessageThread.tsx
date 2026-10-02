import { useLayoutEffect, useRef, useState } from 'react'
import { Check, CheckCheck, CircleAlert, Clock, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { formatMessageTimestamp, messageAlignment, messageStatusLabel } from '@/lib/chatThread'
import type { Message } from '@/lib/queries/conversations'
import { isFollowingAfter } from '@/lib/thread-scroll/followTracking'
import { threadScrollDecision, type ThreadSnapshot } from '@/lib/thread-scroll/threadScrollDecision'

export type MessageThreadProps = {
  messages: Message[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  lastSentId: string | null
}

const bubbleBase = 'max-w-[85%] rounded-lg px-3 py-2 text-sm sm:max-w-[70%]'
const bubbleByKind: Record<Message['author_kind'], string> = {
  client: 'bg-muted text-foreground',
  bot: 'bg-secondary text-secondary-foreground',
  admin: 'bg-primary text-primary-foreground',
}

const STATUS_ICONS: Partial<Record<Message['status'], LucideIcon>> = {
  queued: Clock,
  sent: Check,
  delivered: CheckCheck,
  failed: CircleAlert,
}

const FAILED_ANNOUNCEMENT = 'A message failed to send.'

// Only a message already on screen moving to `failed` counts: one loaded failed, or an echo
// replacing an optimistic bubble (a new id), is not a live change and the composer already says so.
const hasNewlyFailed = (previous: Message[], next: Message[]): boolean => {
  const previousStatuses = new Map(previous.map((message) => [message.id, message.status]))

  return next.some((message) => {
    const before = previousStatuses.get(message.id)

    return message.status === 'failed' && before !== undefined && before !== 'failed'
  })
}

const NEAR_BOTTOM_PX = 100
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const snapshotOf = (messages: Message[]): ThreadSnapshot => ({
  firstId: messages[0]?.id ?? null,
  lastId: messages[messages.length - 1]?.id ?? null,
  length: messages.length,
})

const distanceFromBottomOf = (scroller: HTMLElement): number =>
  scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

export const MessageThread = ({
  messages,
  hasMore,
  loadingMore,
  onLoadMore,
  lastSentId,
}: MessageThreadProps) => {
  const [previousMessages, setPreviousMessages] = useState(messages)
  const [announcement, setAnnouncement] = useState('')
  const scrollerRef = useRef<HTMLDivElement>(null)
  // Last layout measured before the next render; starts "at the bottom".
  const distanceFromBottomRef = useRef(0)
  // True while a smooth follow is in flight, so a message landing mid-scroll still counts as at the
  // bottom (the measured distance is mid-animation) and re-targets the new bottom. See followTracking.
  const isFollowingRef = useRef(false)
  const previousSnapshotRef = useRef<ThreadSnapshot>(snapshotOf([]))

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return

    const previous = previousSnapshotRef.current
    const next = snapshotOf(messages)
    const savedDistance = distanceFromBottomRef.current
    const decision = threadScrollDecision({
      previous,
      next,
      wasNearBottom: isFollowingRef.current || savedDistance <= NEAR_BOTTOM_PX,
      lastIsOwnSend: lastSentId !== null && next.lastId === lastSentId && previous.lastId !== lastSentId,
    })

    const isSmooth = decision === 'follow' && !window.matchMedia(REDUCED_MOTION_QUERY).matches
    isFollowingRef.current = isFollowingAfter(isFollowingRef.current, {
      kind: 'decision',
      decision,
      isSmooth,
      distance: distanceFromBottomOf(scroller),
    })

    if (decision === 'jump' || decision === 'follow') {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: isSmooth ? 'smooth' : 'instant' })
    } else if (decision === 'preserve') {
      // Explicitly instant so a CSS scroll-behavior can never animate the restore.
      scroller.scrollTo({ top: scroller.scrollHeight - scroller.clientHeight - savedDistance, behavior: 'instant' })
    }

    previousSnapshotRef.current = next
    distanceFromBottomRef.current = distanceFromBottomOf(scroller)
    // lastSentId is read only to classify this message change, never a trigger of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

  const handleScroll = () => {
    const scroller = scrollerRef.current
    if (scroller === null) return

    const distance = distanceFromBottomOf(scroller)
    isFollowingRef.current = isFollowingAfter(isFollowingRef.current, {
      kind: 'scroll',
      previousDistance: distanceFromBottomRef.current,
      distance,
    })
    distanceFromBottomRef.current = distance
  }

  // Adjusted during render rather than in an effect, so the announcement lands with the update.
  if (messages !== previousMessages) {
    if (hasNewlyFailed(previousMessages, messages)) setAnnouncement(FAILED_ANNOUNCEMENT)
    setPreviousMessages(messages)
  }

  return (
    <div
      ref={scrollerRef}
      onScroll={handleScroll}
      className="flex flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-4"
    >
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {hasMore && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Loading…' : 'Load older messages'}
          </Button>
        </div>
      )}

      {messages.length === 0 ? (
        <p className="m-auto text-sm text-muted-foreground">No messages yet.</p>
      ) : (
        messages.map((message) => <MessageBubble key={message.id} message={message} />)
      )}
    </div>
  )
}

const MessageBubble = ({ message }: { message: Message }) => {
  const alignment = messageAlignment(message.author_kind)
  const statusLabel = messageStatusLabel(message)
  const StatusIcon = STATUS_ICONS[message.status]

  return (
    <div className={cn('flex flex-col', alignment === 'end' ? 'items-end' : 'items-start')}>
      {message.author_kind === 'admin' && message.author !== null && (
        <span className="mb-0.5 text-xs text-muted-foreground">{message.author.email}</span>
      )}
      <div
        className={cn(
          bubbleBase,
          bubbleByKind[message.author_kind],
          message.status === 'failed' && 'ring-2 ring-destructive',
        )}
      >
        <p className="whitespace-pre-wrap">{message.body}</p>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{formatMessageTimestamp(message.created_at)}</span>
        {statusLabel !== null && (
          <span
            key={message.status}
            className={cn(
              'inline-flex items-center gap-1 animate-in fade-in-0 duration-150 ease-out motion-reduce:animate-none',
              message.status === 'failed' && 'font-medium text-destructive',
            )}
          >
            {StatusIcon !== undefined && <StatusIcon className="size-3 shrink-0" aria-hidden="true" />}
            {statusLabel}
          </span>
        )}
      </div>
    </div>
  )
}
