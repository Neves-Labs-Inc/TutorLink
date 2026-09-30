import { Outlet, useParams } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'

import { SelectedConversationProvider } from '@/components/chat/ConversationList'
import { Chats } from '@/pages/admin/Chats'
import { cn } from '@/lib/utils'

const listPaneClasses = 'w-full lg:w-80 lg:shrink-0 xl:w-96'
const threadPaneClasses = 'min-w-0 flex-1'
const emptyStateClasses =
  'flex h-[calc(100dvh-14rem)] min-h-[24rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center text-muted-foreground'

// The list pane renders unconditionally so it never unmounts when the route
// switches between /chats and /chats/:id — that persistence is what makes
// this a pane rather than a page swap (admin-dashboard-design.md:314).
export const ChatsLayout = () => {
  const { id } = useParams()
  const hasSelection = id !== undefined

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className={cn(listPaneClasses, hasSelection && 'hidden lg:block')}>
        <SelectedConversationProvider conversationId={id}>
          <Chats />
        </SelectedConversationProvider>
      </div>

      <div className={cn(threadPaneClasses, !hasSelection && 'hidden lg:block')}>
        {hasSelection ? (
          <Outlet />
        ) : (
          <div className={emptyStateClasses}>
            <MessageSquare aria-hidden="true" className="size-8" />
            <p className="text-sm font-medium">No conversation selected</p>
            <p className="text-sm">Choose a conversation from the list to view it here.</p>
          </div>
        )}
      </div>
    </div>
  )
}
