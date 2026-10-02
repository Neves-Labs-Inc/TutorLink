import { useState } from 'react'
import { Check, CheckCheck, CircleAlert, Clock, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { formatMessageTimestamp, messageAlignment, messageStatusLabel } from '@/lib/chatThread'
import type { Message } from '@/lib/queries/conversations'

export type MessageThreadProps = {
  messages: Message[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
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

export const MessageThread = ({ messages, hasMore, loadingMore, onLoadMore }: MessageThreadProps) => {
  const [previousMessages, setPreviousMessages] = useState(messages)
  const [announcement, setAnnouncement] = useState('')

  // Adjusted during render rather than in an effect, so the announcement lands with the update.
  if (messages !== previousMessages) {
    if (hasNewlyFailed(previousMessages, messages)) setAnnouncement(FAILED_ANNOUNCEMENT)
    setPreviousMessages(messages)
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
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
