// Everything a chat thread reads: the detail, its message pages (newest
// first, older ones by `before` cursor), the live frames that keep both
// fresh, and the mark-read that runs when the chat opens. Replies go out
// through the stream and show as pending bubbles until their echo lands.
import { useEffect, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import axios from "axios";
import { useConversationStream } from "@/hooks/use-conversation-stream/useConversationStream";
import {
  applyMessageToPages,
  applyMessageUpdate,
  assembleThread,
  markConversationRead,
  mergeMessagePages,
  messageAreaState,
  oldestCreatedAt,
  olderPageState,
  optimisticMessage,
  reconcileLiveMessage,
} from "@/lib/chatThread";
import { FIRST_CONTROL_TARGETS } from "@/hooks/use-footer-focus";
import { getHandedBackDetail } from "@/lib/chats/hand-back";
import type {
  MessageAreaState,
  OlderPageState,
  PageStatus,
} from "@/lib/chatThread";
import { conversationQueries } from "@/lib/queries/conversations";
import type { ConversationDetail, Message } from "@/lib/queries/conversations";
import { countsQueries } from "@/lib/queries/counts";
import type { Page } from "@/lib/queries/page";
import { useFooterFocusStore } from "@/stores/footer-focus-store";
import { useHandBackStore } from "@/stores/hand-back-store";

const LIST_KEY: QueryKey = ["conversations", "list"];
const WINDOW_CLOSED_CODE = "window_closed";

// Every page of one chat's messages, whatever its `before` cursor.
export function getMessagesKeyPrefix(conversationId: string): QueryKey {
  return conversationQueries.messages(conversationId).queryKey.slice(0, -1);
}

export function getDetailKey(conversationId: string): QueryKey {
  return conversationQueries.detail(conversationId).queryKey;
}

export type ChatThreadLoad = "loading" | "error" | "ready";

export type ChatComposer = {
  isConnected: boolean;
  // A stream refusal other than the window closing, until the next send.
  error: string | null;
  send: (body: string) => void;
};

export type ChatThread = {
  load: ChatThreadLoad;
  detail: ConversationDetail | null;
  isRetrying: boolean;
  retryLoad: () => void;
  messages: Message[];
  messageState: MessageAreaState;
  hasOlder: boolean;
  olderState: OlderPageState;
  loadOlder: () => void;
  // Messages newer than this arrived after the chat opened, so they
  // animate in; null until the first page has landed.
  liveAfterMs: number | null;
  // The newest reply sent from here, so the thread follows it down.
  lastSentId: string | null;
  composer: ChatComposer;
};

type QueryState = {
  data: unknown;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
};

function getPageStatus(query: QueryState): PageStatus {
  return {
    hasData: query.data !== undefined,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}

function addToNewestPage(
  current: Page<Message> | undefined,
  message: Message,
): Page<Message> | undefined {
  if (current === undefined) return current;
  if (current.items.some((item) => item.id === message.id)) return current;
  return {
    ...current,
    items: [message, ...current.items],
    total: current.total + 1,
  };
}

// The send the socket refused stays on screen, so its text can be read
// and copied, with why it didn't go.
function markRefused(
  pending: Message[],
  sentIds: ReadonlySet<string>,
): Message[] {
  return pending.map((message) =>
    sentIds.has(message.id) && message.status === "queued"
      ? { ...message, status: "failed", error_code: WINDOW_CLOSED_CODE }
      : message,
  );
}

function getNewestMs(messages: Message[]): number {
  const newest = messages.at(-1);
  return newest === undefined ? 0 : Date.parse(newest.created_at);
}

export function useChatThread(conversationId: string): ChatThread {
  const queryClient = useQueryClient();
  const [cursors, setCursors] = useState<string[]>([]);
  const [liveAfterMs, setLiveAfterMs] = useState<number | null>(null);
  const [pending, setPending] = useState<Message[]>([]);
  const [lastSentId, setLastSentId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const sentIdsRef = useRef(new Set<string>());
  const isHandingBack = useHandBackStore((state) =>
    state.pending.has(conversationId),
  );
  const detailKey = getDetailKey(conversationId);
  const newestPageKey = conversationQueries.messages(conversationId).queryKey;

  useEffect(() => {
    markConversationRead(conversationId)
      .then((updated) => {
        queryClient.setQueryData(getDetailKey(conversationId), updated);
        void queryClient.invalidateQueries({ queryKey: LIST_KEY });
        void queryClient.invalidateQueries({
          queryKey: countsQueries.detail().queryKey,
        });
      })
      .catch((error: unknown) => {
        // The chat still reads fine; it just stays unread for the office.
        // Only the status: the error's request config carries the token.
        const httpStatus = axios.isAxiosError(error)
          ? (error.response?.status ?? null)
          : null;
        console.warn("chat thread: mark read failed", {
          conversationId,
          httpStatus,
        });
      });
  }, [conversationId, queryClient]);

  const detail = useQuery(conversationQueries.detail(conversationId));
  const pages = useQueries({
    queries: [
      conversationQueries.messages(conversationId),
      ...cursors.map((before) =>
        conversationQueries.messages(conversationId, { before }),
      ),
    ],
  });

  const stream = useConversationStream({
    onMessageCreated: (frame) => {
      if (frame.conversation_id !== conversationId) return;
      const clientMessageId = frame.client_message_id;
      const isOwnSend =
        clientMessageId !== undefined && sentIdsRef.current.has(clientMessageId);
      if (isOwnSend) {
        setPending((current) =>
          reconcileLiveMessage(current, frame.message, clientMessageId),
        );
      }
      if (cursors.length === 0) {
        void queryClient.invalidateQueries({
          queryKey: newestPageKey,
          exact: true,
        });
      } else {
        // Older pages are pinned to the newest page's first window, so a
        // refetch would slide it and drop the message at the seam.
        queryClient.setQueryData<Page<Message>>(newestPageKey, (current) =>
          addToNewestPage(current, frame.message),
        );
      }
      void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
    },
    // A status change swaps the message in place in whichever page has it.
    onMessageUpdated: (frame) => {
      if (frame.conversation_id !== conversationId) return;
      setPending((current) => applyMessageUpdate(current, frame.message));
      void applyMessageToPages(
        queryClient,
        getMessagesKeyPrefix(conversationId),
        frame.message,
      );
    },
    onConversationUpdated: (conversation) => {
      if (conversation.id !== conversationId) return;
      void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
    },
    onError: (detail, code) => {
      if (code !== WINDOW_CLOSED_CODE) {
        setSendError(detail);
        return;
      }
      // The footer turns into the closed-window notice once this lands.
      setPending((current) => markRefused(current, sentIdsRef.current));
      // The composer that had focus gives way to the closed notice.
      useFooterFocusStore
        .getState()
        .requestFocus(conversationId, FIRST_CONTROL_TARGETS);
      void queryClient.invalidateQueries({ queryKey: detailKey, exact: true });
    },
  });

  const newestPage = pages[0];
  const messages = assembleThread(
    mergeMessagePages(pages.map((query) => query.data?.items ?? [])),
    pending,
  );
  const messageState = messageAreaState(
    getPageStatus(newestPage),
    messages.length,
  );
  const olderPage = cursors.length > 0 ? pages[pages.length - 1] : null;
  const olderState = olderPageState(
    olderPage === null ? null : getPageStatus(olderPage),
  );
  const total = newestPage.data?.total ?? 0;

  // Set during render, not in an effect, so the first page never animates.
  if (liveAfterMs === null && newestPage.data !== undefined) {
    setLiveAfterMs(getNewestMs(messages));
  }

  let load: ChatThreadLoad = "ready";
  // A failed background refetch keeps the cached chat on screen.
  const hasDetailFailed = detail.isError && detail.data === undefined;
  if (hasDetailFailed || messageState === "error") {
    load = "error";
  } else if (detail.data === undefined) {
    load = "loading";
  }

  function retryLoad(): void {
    if (detail.isError) void detail.refetch();
    if (newestPage.isError) void newestPage.refetch();
  }

  function send(body: string): void {
    const holder = detail.data?.taken_over_by ?? null;
    if (holder === null) return;

    const clientMessageId = crypto.randomUUID();
    sentIdsRef.current.add(clientMessageId);
    setSendError(null);
    setPending((current) => [
      ...current,
      optimisticMessage(clientMessageId, body, holder.id, holder.name),
    ]);
    setLastSentId(clientMessageId);
    stream.send(conversationId, body, clientMessageId);
  }

  function loadOlder(): void {
    // A failed older page retries itself; another cursor would duplicate it.
    if (olderPage !== null && olderState === "error") {
      void olderPage.refetch();
      return;
    }
    const cursor = oldestCreatedAt(messages);
    if (cursor !== null) setCursors((current) => [...current, cursor]);
  }

  // A refetch inside a Hand back's Undo window still shows the bot.
  let shownDetail = detail.data ?? null;
  if (shownDetail !== null && isHandingBack) {
    shownDetail = getHandedBackDetail(shownDetail);
  }

  return {
    load,
    detail: shownDetail,
    isRetrying: detail.isFetching || newestPage.isFetching,
    retryLoad,
    messages,
    messageState,
    hasOlder: messages.length < total,
    olderState,
    loadOlder,
    liveAfterMs,
    lastSentId,
    composer: {
      isConnected: stream.status === "connected",
      error: sendError,
      send,
    },
  };
}
