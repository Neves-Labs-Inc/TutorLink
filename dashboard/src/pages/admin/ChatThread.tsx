import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'

import { MarkHandledButton } from '@/components/chat/MarkHandledButton'
import { MessageComposer } from '@/components/chat/MessageComposer'
import { MessageThread } from '@/components/chat/MessageThread'
import { ReactivationRequestPanel } from '@/components/chat/ReactivationRequestPanel'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { useConversationStream } from '@/hooks/use-conversation-stream/useConversationStream'
import { errorDetail } from '@/lib/api'
import { decodeAccessToken } from '@/lib/auth/auth'
import {
  applyMessageUpdate,
  isHeldByAdmin,
  isHeldByOtherAdmin,
  markConversationRead,
  mergeMessagePages,
  oldestCreatedAt,
  optimisticMessage,
  reconcileLiveMessage,
  releaseConversation,
  takeoverConversation,
} from '@/lib/chatThread'
import { conversationQueries, type Message } from '@/lib/queries/conversations'
import type { Page } from '@/lib/queries/page'
import { useAuthStore } from '@/stores/authStore'

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const TAKEOVER_FALLBACK_ERROR = 'Could not take over this conversation.'
const RELEASE_FALLBACK_ERROR = 'Could not release this conversation.'
const LOADING_ROWS = [0, 1, 2, 3]

const backLinkClasses =
  'inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

export const ChatThread = () => {
  const { id = '' } = useParams()

  return <ChatThreadView key={id} conversationId={id} />
}

type ChatThreadViewProps = { conversationId: string }

// Every page of this thread's messages, whatever its `before` cursor.
const messagesQueryPrefix = (conversationId: string) =>
  conversationQueries.messages(conversationId).queryKey.slice(0, -1)

const ChatThreadView = ({ conversationId: id }: ChatThreadViewProps) => {
  const queryClient = useQueryClient()
  const accessToken = useAuthStore((state) => state.accessToken)
  const currentUserId = accessToken === null ? null : (decodeAccessToken(accessToken)?.sub ?? null)

  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [pendingMessages, setPendingMessages] = useState<Message[]>([])
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)

  useEffect(() => {
    if (id !== '') {
      markConversationRead(id).then((updated) =>
        queryClient.setQueryData(conversationQueries.detail(id).queryKey, updated),
      )
    }
  }, [id, queryClient])

  const conversation = useQuery(conversationQueries.detail(id))

  const pages = useQueries({
    queries: cursors.map((cursor) =>
      conversationQueries.messages(id, cursor === undefined ? {} : { before: cursor }),
    ),
  })

  const stream = useConversationStream({
    onMessageCreated: (frame) => {
      if (frame.conversation_id === id) {
        if (frame.client_message_id !== undefined) {
          setPendingMessages((current) =>
            reconcileLiveMessage(current, frame.message, frame.client_message_id),
          )
        }

        queryClient.invalidateQueries({
          queryKey: conversationQueries.messages(id, {}).queryKey,
          exact: true,
        })
        queryClient.invalidateQueries({
          queryKey: conversationQueries.detail(id).queryKey,
          exact: true,
        })
      }
    },
    // A status change swaps the message in place, in every cached page and in the pending list
    // (which wins over the pages when the thread is assembled), so the bubble never refetches.
    onMessageUpdated: (frame) => {
      if (frame.conversation_id === id) {
        setPendingMessages((current) => applyMessageUpdate(current, frame.message))
        queryClient.setQueriesData<Page<Message>>(
          { queryKey: messagesQueryPrefix(id) },
          (page) => {
            if (page === undefined) return page

            const items = applyMessageUpdate(page.items, frame.message)

            return items === page.items ? page : { ...page, items }
          },
        )
      }
    },
    onConversationUpdated: (updated) => {
      if (updated.id === id) {
        queryClient.invalidateQueries({
          queryKey: conversationQueries.detail(id).queryKey,
          exact: true,
        })
      }
    },
  })

  const takeover = useMutation({
    mutationFn: () => takeoverConversation(id),
    onSuccess: (updated) => queryClient.setQueryData(conversationQueries.detail(id).queryKey, updated),
  })

  const release = useMutation({
    mutationFn: () => releaseConversation(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(conversationQueries.detail(id).queryKey, updated)
      setReleaseDialogOpen(false)
    },
  })

  const paged = mergeMessagePages(pages.map((page) => page.data?.items ?? []))
  const thread = pendingMessages.reduce((acc, message) => reconcileLiveMessage(acc, message), paged)
  const total = pages[0]?.data?.total ?? conversation.data?.message_count ?? 0
  const hasMore = thread.length < total
  const loadingMore = pages[pages.length - 1]?.isFetching ?? false

  const handleLoadMore = () => {
    const cursor = oldestCreatedAt(paged)

    if (cursor !== null) setCursors((current) => [...current, cursor])
  }

  const handleSend = (body: string) => {
    const holder = conversation.data?.taken_over_by

    if (holder !== null && holder !== undefined) {
      const clientMessageId = crypto.randomUUID()

      setPendingMessages((current) => [
        ...current,
        optimisticMessage(clientMessageId, body, holder.id, holder.email),
      ])
      stream.send(id, body, clientMessageId)
    }
  }

  let content: ReactNode

  if (conversation.isPending) {
    content = (
      <div aria-busy="true" className="space-y-3">
        <p className="text-sm text-muted-foreground">Loading conversation…</p>
        {LOADING_ROWS.map((row) => (
          <div key={row} className="h-8 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    )
  } else if (conversation.isError) {
    content = (
      <div className="space-y-4">
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorDetail(conversation.error) ?? LOAD_FALLBACK_ERROR}
        </p>
        <Button type="button" variant="outline" onClick={() => conversation.refetch()}>
          Try again
        </Button>
      </div>
    )
  } else {
    const detail = conversation.data
    const heldByMe = currentUserId !== null && isHeldByAdmin(detail, currentUserId)
    const heldByOther = currentUserId !== null && isHeldByOtherAdmin(detail, currentUserId)

    content = (
      <div className="space-y-3">
        {detail.reactivation_request && (
          <ReactivationRequestPanel conversationId={id} request={detail.reactivation_request} />
        )}

        <div className="flex h-[calc(100dvh-14rem)] min-h-[24rem] flex-col overflow-hidden rounded-lg border border-border bg-card">
          {detail.status === 'human' && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-2 text-sm">
              <p className="text-muted-foreground">
                The bot is paused — held by {detail.taken_over_by?.email ?? 'another admin'}.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setReleaseDialogOpen(true)}
              >
                Release to bot
              </Button>
            </div>
          )}

          <MessageThread
            messages={thread}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
          />

          {heldByMe && (
            <>
              {stream.error !== null && (
                <p role="alert" className="border-t border-border px-3 pt-2 text-sm font-medium text-destructive">
                  {stream.error}
                </p>
              )}
              <MessageComposer disabled={stream.status !== 'connected'} onSend={handleSend} />
            </>
          )}

          {!heldByMe && !heldByOther && (
            <div className="flex flex-col items-start gap-2 border-t border-border p-3">
              <Button type="button" onClick={() => takeover.mutate()} disabled={takeover.isPending}>
                {takeover.isPending ? 'Taking over…' : 'Take over'}
              </Button>
              {takeover.isError && (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {errorDetail(takeover.error) ?? TAKEOVER_FALLBACK_ERROR}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Link to="/chats" className={backLinkClasses}>
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to chats
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {conversation.data?.guardian?.name ?? conversation.data?.phone_number ?? 'Conversation'}
          </h1>
          {conversation.data?.flag_reason && <StatusBadge status={conversation.data.flag_reason} />}
          {conversation.data && <MarkHandledButton conversation={conversation.data} />}
        </div>
        {conversation.data && (
          <p className="text-sm text-muted-foreground">
            {conversation.data.phone_number} · {total} message{total === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {content}

      <ConfirmDialog
        open={releaseDialogOpen}
        onOpenChange={setReleaseDialogOpen}
        title="Release to bot"
        body="The bot resumes from a fresh flow, not from where this conversation left off. The client will not see this handoff."
        confirmLabel="Release"
        destructive
        pending={release.isPending}
        errorMessage={release.isError ? (errorDetail(release.error) ?? RELEASE_FALLBACK_ERROR) : null}
        onConfirm={() => release.mutate()}
      />
    </div>
  )
}
