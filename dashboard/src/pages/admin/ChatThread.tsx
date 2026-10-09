import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'

import { GuardianLanguageSelect } from '@/components/guardians/GuardianLanguageSelect'
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
  applyMessageToPages,
  applyMessageUpdate,
  assembleThread,
  canTransfer,
  composerClosedNotice,
  focusRequest,
  OTHER_HOLDER_FALLBACK,
  refusalFocusTarget,
  handBackConfirmBody,
  isFocusAdrift,
  isFocusRequestLive,
  isHeldByAdmin,
  isTakeoverOffered,
  isTransferOffered,
  markConversationRead,
  markMessagesFailed,
  mergeMessagePages,
  oldestCreatedAt,
  optimisticMessage,
  reconcileLiveMessage,
  releaseConversation,
  socketSaysClosed,
  takeoverClosedNotice,
  takeoverConversation,
  transferConfirmBody,
  type FocusPlace,
  type FocusRequest,
  type RefusedAction,
} from '@/lib/chatThread'
import {
  conversationQueries,
  retryNotice,
  transferConversation,
  updateConversationLanguage,
  type Message,
} from '@/lib/queries/conversations'
import { meQueries } from '@/lib/queries/me'
import type { Language } from '@/lib/reminders/reminders'
import { useAuthStore } from '@/stores/authStore'

const LOAD_FALLBACK_ERROR = 'Something went wrong. Please try again.'
const TAKEOVER_FALLBACK_ERROR = 'Could not take over this conversation.'
const RELEASE_FALLBACK_ERROR = 'Could not hand back this conversation.'
const TRANSFER_FALLBACK_ERROR = 'Could not transfer this conversation.'
const RETRY_FALLBACK_ERROR = 'Could not retry this notice.'
const LANGUAGE_FALLBACK_ERROR = 'Could not change the language.'
// Where focus goes after a change unmounts or disables what had it, tried in order.
const COMPOSER_FOCUS_TARGETS = ['textarea:not([disabled])', '[data-hand-back]']
const RETRY_FOCUS_TARGETS = ['[data-retry]:not([disabled])', ...COMPOSER_FOCUS_TARGETS]
const WINDOW_CLOSED_FOCUS_TARGETS = ['[data-hand-back]']
const WINDOW_CLOSED_CODE = 'window_closed'

const backLinkClasses =
  'inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const ChatPanelSkeleton = () => (
  <div
    aria-busy="true"
    className="flex h-[calc(100dvh-14rem)] min-h-[24rem] flex-col overflow-hidden rounded-lg border border-border bg-card"
  >
    <span className="sr-only">Loading conversation…</span>
    <div className="flex flex-1 flex-col gap-3 p-4">
      <div className="h-10 w-2/3 animate-pulse rounded-lg bg-muted motion-reduce:animate-none sm:w-2/5" />
      <div className="h-3 w-48 animate-pulse self-center rounded-lg bg-muted motion-reduce:animate-none" />
      <div className="h-10 w-1/2 animate-pulse self-end rounded-lg bg-muted motion-reduce:animate-none sm:w-1/3" />
      <div className="h-16 w-3/4 animate-pulse rounded-lg bg-muted motion-reduce:animate-none sm:w-1/2" />
      <div className="h-10 w-2/5 animate-pulse self-end rounded-lg bg-muted motion-reduce:animate-none sm:w-1/4" />
    </div>
    <div className="border-t border-border p-3">
      <div className="h-16 rounded-lg bg-muted" />
    </div>
  </div>
)

export const ChatThread = () => {
  const { id = '' } = useParams()

  return <ChatThreadView key={id} conversationId={id} />
}

type ChatThreadViewProps = { conversationId: string }

// Every page of this thread's messages, whatever its `before` cursor.
const messagesQueryPrefix = (conversationId: string) =>
  conversationQueries.messages(conversationId).queryKey.slice(0, -1)

// A refused action whose focus is still being looked after, until its detail refetch has landed.
type Refusal = { action: RefusedAction; isRefetched: boolean }

const focusPlace = (active: Element | null): FocusPlace => {
  const dialog = active?.closest('[role="dialog"]') ?? null
  let place: FocusPlace = { kind: 'page' }

  if (active === null || active === document.body) {
    place = { kind: 'body' }
  } else if (dialog !== null) {
    place = { kind: 'dialog', state: dialog.getAttribute('data-state') }
  }
  return place
}

const ChatThreadView = ({ conversationId: id }: ChatThreadViewProps) => {
  const queryClient = useQueryClient()
  const accessToken = useAuthStore((state) => state.accessToken)
  const currentUserId = accessToken === null ? null : (decodeAccessToken(accessToken)?.sub ?? null)

  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [pendingMessages, setPendingMessages] = useState<Message[]>([])
  const [lastSentId, setLastSentId] = useState<string | null>(null)
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const pendingFocusRef = useRef<FocusRequest | null>(null)
  const sentIdsRef = useRef(new Set<string>())
  // The Guardian's last message when the socket refused a send as window_closed. The flag only
  // holds while that stays true: a newer Guardian message reopens the window by itself.
  const [socketClosedFor, setSocketClosedFor] = useState<{ lastClientMessageAt: string | null } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const settledRefusalRef = useRef<Refusal | null>(null)

  // Runs after every render until its target exists or the request lapses: the target may mount a
  // render later (the transfer response lands after the dialog closes), and the dialog's focus trap
  // pulls focus back while it is still open.
  useEffect(() => {
    const request = pendingFocusRef.current

    if (request !== null && !isFocusRequestLive(request, Date.now())) {
      pendingFocusRef.current = null
    } else if (request !== null && !transferDialogOpen) {
      const found = request.targets
        .map((selector) => panelRef.current?.querySelector<HTMLElement>(selector))
        .find((element) => element !== null && element !== undefined)

      if (found) {
        found.focus()
        pendingFocusRef.current = null
      }
    }
  })

  // A refused action's button is disabled while pending, then its refetch may unmount it (or the
  // Transfer trigger behind a closing dialog). Whenever focus is adrift, hand it to the control the
  // page now offers, however long the refetch takes; stop looking after it once the refetch landed.
  useEffect(() => {
    const isPaused = transferDialogOpen || releaseDialogOpen

    if (refusal !== null && refusal !== settledRefusalRef.current && !isPaused) {
      if (isFocusAdrift(focusPlace(document.activeElement))) {
        const target = refusalFocusTarget(
          refusal.action,
          (selector) => panelRef.current?.querySelector<HTMLElement>(selector) ?? null,
        )
        target?.focus()
      }
      if (refusal.isRefetched) {
        settledRefusalRef.current = refusal
      }
    }
  })

  useEffect(() => {
    if (id !== '') {
      markConversationRead(id).then((updated) =>
        queryClient.setQueryData(conversationQueries.detail(id).queryKey, updated),
      )
    }
  }, [id, queryClient])

  const conversation = useQuery(conversationQueries.detail(id))
  const me = useQuery(meQueries.detail())

  const pages = useQueries({
    queries: cursors.map((cursor) =>
      conversationQueries.messages(id, cursor === undefined ? {} : { before: cursor }),
    ),
  })

  const applyMessageEverywhere = (updated: Message) => {
    setPendingMessages((current) => applyMessageUpdate(current, updated))
    applyMessageToPages(queryClient, messagesQueryPrefix(id), updated)
  }

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
    // (for a message no page carries yet), so the bubble never refetches.
    onMessageUpdated: (frame) => {
      if (frame.conversation_id === id) {
        applyMessageEverywhere(frame.message)
      }
    },
    onError: (_detail, code) => {
      if (code === WINDOW_CLOSED_CODE) {
        setSocketClosedFor({ lastClientMessageAt: conversation.data?.last_client_message_at ?? null })
        setPendingMessages((current) => markMessagesFailed(current, sentIdsRef.current))
        pendingFocusRef.current = focusRequest(WINDOW_CLOSED_FOCUS_TARGETS, Date.now())
        // The cached "last wrote" time may be stale: the server just said the window is closed.
        queryClient.invalidateQueries({
          queryKey: conversationQueries.detail(id).queryKey,
          exact: true,
        })
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

  const handleRefusal = (action: RefusedAction) => {
    setRefusal({ action, isRefetched: false })
    queryClient
      .invalidateQueries({ queryKey: conversationQueries.detail(id).queryKey, exact: true })
      .then(() =>
        setRefusal((current) => (current?.action === action ? { action, isRefetched: true } : current)),
      )
  }

  const takeover = useMutation({
    mutationFn: () => takeoverConversation(id),
    onMutate: () => setRefusal(null),
    // A refusal usually means the window closed since the page loaded: refetch so the explanation
    // replaces the button.
    onError: () => handleRefusal({ kind: 'takeover' }),
    onSuccess: (updated) => queryClient.setQueryData(conversationQueries.detail(id).queryKey, updated),
  })

  const changeLanguage = useMutation({
    mutationFn: (language: Language | null) => updateConversationLanguage(id, language),
    onSuccess: (updated) => queryClient.setQueryData(conversationQueries.detail(id).queryKey, updated),
  })

  const release = useMutation({
    mutationFn: () => releaseConversation(id),
    onSuccess: (updated) => {
      queryClient.setQueryData(conversationQueries.detail(id).queryKey, updated)
      setReleaseDialogOpen(false)
    },
  })

  const transfer = useMutation({
    mutationFn: () => transferConversation(id),
    onMutate: () => setRefusal(null),
    // The dialog shows the refusal; the refetch swaps the button for the explanation behind it.
    onError: () => handleRefusal({ kind: 'transfer' }),
    onSuccess: (updated) => {
      queryClient.setQueryData(conversationQueries.detail(id).queryKey, updated)
      pendingFocusRef.current = focusRequest(COMPOSER_FOCUS_TARGETS, Date.now())
      setTransferDialogOpen(false)
    },
  })

  const retry = useMutation({
    mutationFn: (messageId: string) => retryNotice(id, messageId),
    onMutate: () => setRefusal(null),
    // A refusal means the window closed since the page loaded: refetch so Retry goes away.
    onError: (_error, messageId) => handleRefusal({ kind: 'retry', messageId }),
    onSuccess: (updated) => {
      pendingFocusRef.current = focusRequest(RETRY_FOCUS_TARGETS, Date.now())
      applyMessageEverywhere(updated)
    },
  })

  const paged = mergeMessagePages(pages.map((page) => page.data?.items ?? []))
  const thread = assembleThread(paged, pendingMessages)
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
        optimisticMessage(clientMessageId, body, holder.id, holder.name),
      ])
      setLastSentId(clientMessageId)
      sentIdsRef.current.add(clientMessageId)
      stream.send(id, body, clientMessageId)
    }
  }

  const holder = conversation.data?.taken_over_by
  const holderName = holder?.name ?? null
  const guardianName = conversation.data?.guardian?.name ?? conversation.data?.phone_number ?? 'The Guardian'

  let content: ReactNode

  if (conversation.isPending) {
    content = <ChatPanelSkeleton />
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
    const heldByOther = currentUserId !== null && canTransfer(detail, currentUserId)
    const takeoverNotice = takeoverClosedNotice(detail)
    const closedNotice = heldByMe
      ? composerClosedNotice(detail, new Date(), socketSaysClosed(socketClosedFor, detail))
      : null

    content = (
      <div className="space-y-3">
        {detail.reactivation_request && (
          <ReactivationRequestPanel conversationId={id} request={detail.reactivation_request} />
        )}

        <div
          ref={panelRef}
          className="flex h-[calc(100dvh-14rem)] min-h-[24rem] flex-col overflow-hidden rounded-lg border border-border bg-card"
        >
          {detail.status === 'human' && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-4 py-2 text-sm">
              <p className="text-muted-foreground">{heldByMe ? 'Held by you' : `Held by ${holderName ?? OTHER_HOLDER_FALLBACK}`}</p>
              {heldByOther && !isTransferOffered(detail) ? (
                <p tabIndex={-1} data-takeover-closed className="text-muted-foreground outline-none">
                  {takeoverNotice}
                </p>
              ) : heldByOther ? (
                <Button
                  key="transfer"
                  data-transfer
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 md:h-7"
                  onClick={() => {
                    transfer.reset()
                    setTransferDialogOpen(true)
                  }}
                >
                  Transfer to me
                </Button>
              ) : heldByMe ? (
                <Button
                  key="hand-back"
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 md:h-7"
                  data-hand-back
                  onClick={() => {
                    release.reset()
                    setReleaseDialogOpen(true)
                  }}
                >
                  Hand back to bot
                </Button>
              ) : null}
            </div>
          )}

          <MessageThread
            messages={thread}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={handleLoadMore}
            lastSentId={lastSentId}
            isWindowOpen={detail.is_window_open}
            retry={{
              isPending: retry.isPending,
              pendingId: retry.isPending ? retry.variables : null,
              error: retry.isError
                ? { messageId: retry.variables, text: errorDetail(retry.error) ?? RETRY_FALLBACK_ERROR }
                : null,
              onRetry: (messageId) => retry.mutate(messageId),
            }}
          />

          {heldByMe && (
            <>
              {stream.error !== null && stream.errorCode !== WINDOW_CLOSED_CODE && closedNotice === null && (
                <p role="alert" className="border-t border-border px-3 pt-2 text-sm font-medium text-destructive">
                  {stream.error}
                </p>
              )}
              <MessageComposer
                disabled={stream.status !== 'connected'}
                closedNotice={closedNotice}
                onSend={handleSend}
              />
            </>
          )}

          {!heldByMe && !heldByOther && !isTakeoverOffered(detail) && (
            <div className="border-t border-border p-3">
              <p tabIndex={-1} data-takeover-closed className="text-sm text-muted-foreground outline-none">
                {takeoverNotice}
              </p>
            </div>
          )}

          {!heldByMe && !heldByOther && isTakeoverOffered(detail) && (
            <div className="flex flex-col items-start gap-2 border-t border-border p-3">
              <Button data-takeover type="button" onClick={() => takeover.mutate()} disabled={takeover.isPending}>
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
          {conversation.data && (
            <GuardianLanguageSelect
              id="chat-language"
              variant="inline"
              value={changeLanguage.isPending ? changeLanguage.variables : conversation.data.language}
              disabled={changeLanguage.isPending}
              onChange={(language) => changeLanguage.mutate(language)}
            />
          )}
        </div>
        {changeLanguage.isError && (
          <p
            role="alert"
            className="animate-in text-sm font-medium text-destructive duration-150 ease-out fade-in-0 motion-reduce:animate-none"
          >
            {errorDetail(changeLanguage.error) ?? LANGUAGE_FALLBACK_ERROR}
          </p>
        )}
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
        title="Hand back to bot"
        body={handBackConfirmBody(guardianName)}
        confirmLabel="Hand back"
        destructive
        pending={release.isPending}
        errorMessage={release.isError ? (errorDetail(release.error) ?? RELEASE_FALLBACK_ERROR) : null}
        onConfirm={() => release.mutate()}
      />

      <ConfirmDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        title="Transfer to me"
        body={transferConfirmBody(holderName, me.data?.name ?? null)}
        confirmLabel="Transfer to me"
        pending={transfer.isPending}
        confirmDisabled={conversation.data ? !isTransferOffered(conversation.data) : false}
        errorMessage={transfer.isError ? (errorDetail(transfer.error) ?? TRANSFER_FALLBACK_ERROR) : null}
        onConfirm={() => transfer.mutate()}
      />
    </div>
  )
}
