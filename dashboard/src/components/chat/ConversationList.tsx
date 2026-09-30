import { createContext, useContext, type ReactNode } from 'react'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { conversationDisplayName, conversationHolderLabel, relativeTimeLabel } from '@/lib/chatList'
import type { Conversation } from '@/lib/queries/conversations'
import { cn } from '@/lib/utils'

export type ConversationListProps = {
  conversations: Conversation[]
  status: 'pending' | 'error' | 'ready'
  errorMessage?: string | null
  onRetry: () => void
  emptyMessage: string
  onSelect: (conversation: Conversation) => void
  now: Date
  selectedConversationId?: string
}

const SelectedConversationContext = createContext<string | undefined>(undefined)
const unreadDotClasses = 'inline-block size-2 shrink-0 rounded-full bg-primary'

export const ConversationList = ({
  conversations,
  status,
  errorMessage,
  onRetry,
  emptyMessage,
  onSelect,
  now,
  selectedConversationId,
}: ConversationListProps) => {
  const contextSelectedId = useContext(SelectedConversationContext)
  const selectedId = selectedConversationId ?? contextSelectedId
  const columns: Column<Conversation>[] = [
    {
      id: 'conversation',
      header: 'Conversation',
      primary: true,
      cell: (conversation) => (
        <ConversationCell
          conversation={conversation}
          isSelected={conversation.id === selectedId}
          now={now}
        />
      ),
    },
  ]

  return (
    <DataTable
      caption="Chats"
      columns={columns}
      rows={conversations}
      rowKey={(conversation) => conversation.id}
      status={status}
      errorMessage={errorMessage}
      onRetry={onRetry}
      emptyMessage={emptyMessage}
      onRowSelect={onSelect}
    />
  )
}

type SelectedConversationProviderProps = { conversationId?: string; children: ReactNode }

// ChatsLayout renders this list through pages/admin/Chats.tsx, a file no
// chat-composition task may edit, so it hands the open conversation's id
// down through this provider instead of a prop threaded through that file.
export const SelectedConversationProvider = ({
  conversationId,
  children,
}: SelectedConversationProviderProps) => (
  <SelectedConversationContext.Provider value={conversationId}>
    {children}
  </SelectedConversationContext.Provider>
)

type ConversationCellProps = { conversation: Conversation; isSelected: boolean; now: Date }

const ConversationCell = ({ conversation, isSelected, now }: ConversationCellProps) => {
  const holder = conversationHolderLabel(conversation)

  return (
    <div
      className={cn(
        'max-w-72 space-y-1.5 border-l-2 pl-2',
        isSelected ? 'border-l-primary bg-muted/60' : 'border-l-transparent',
        conversation.unread && 'font-semibold',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {conversation.unread && <span aria-hidden="true" className={unreadDotClasses} />}
          <span className="truncate">{conversationDisplayName(conversation)}</span>
        </div>
        <span className="shrink-0 text-xs font-normal text-muted-foreground">
          {relativeTimeLabel(conversation.last_message_at, now)}
        </span>
      </div>
      {conversation.guardian !== null && (
        <div className="text-xs font-normal text-muted-foreground">{conversation.phone_number}</div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={holder !== null ? 'human' : 'bot'} />
        {holder !== null && (
          <span className="text-xs font-normal text-muted-foreground">{holder}</span>
        )}
        {conversation.flag_reason && <StatusBadge status={conversation.flag_reason} />}
      </div>
      <div className="truncate text-sm font-normal text-muted-foreground">
        {conversation.last_message_preview}
      </div>
    </div>
  )
}
