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

export const MessageThread = ({ messages, hasMore, loadingMore, onLoadMore }: MessageThreadProps) => (
  <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
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

const MessageBubble = ({ message }: { message: Message }) => {
  const alignment = messageAlignment(message.author_kind)
  const statusLabel = messageStatusLabel(message)

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
          <span className={cn(message.status === 'failed' && 'font-medium text-destructive')}>
            {statusLabel}
          </span>
        )}
      </div>
    </div>
  )
}
