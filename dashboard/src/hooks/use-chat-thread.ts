// Everything a chat thread reads: the detail, its message pages (newest
// first, older ones by `before` cursor), the live frames that keep both
// fresh, and the mark-read that runs when the chat opens.
import { useEffect, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useConversationStream } from "@/hooks/use-conversation-stream/useConversationStream";
import {
  applyMessageToPages,
  markConversationRead,
  mergeMessagePages,
  messageAreaState,
  oldestCreatedAt,
  olderPageState,
} from "@/lib/chatThread";
import type {
  MessageAreaState,
  OlderPageState,
  PageStatus,
} from "@/lib/chatThread";
import { conversationQueries } from "@/lib/queries/conversations";
import type { ConversationDetail, Message } from "@/lib/queries/conversations";
import { countsQueries } from "@/lib/queries/counts";
import type { Page } from "@/lib/queries/page";

const LIST_KEY: QueryKey = ["conversations", "list"];

// Every page of one chat's messages, whatever its `before` cursor.
export function getMessagesKeyPrefix(conversationId: string): QueryKey {
  return conversationQueries.messages(conversationId).queryKey.slice(0, -1);
}

export function getDetailKey(conversationId: string): QueryKey {
  return conversationQueries.detail(conversationId).queryKey;
}

export type ChatThreadLoad = "loading" | "error" | "ready";

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

function getNewestMs(messages: Message[]): number {
  const newest = messages.at(-1);
  return newest === undefined ? 0 : Date.parse(newest.created_at);
}

export function useChatThread(conversationId: string): ChatThread {
  const queryClient = useQueryClient();
  const [cursors, setCursors] = useState<string[]>([]);
  const [liveAfterMs, setLiveAfterMs] = useState<number | null>(null);
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
        console.warn("chat thread: mark read failed", { conversationId, error });
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

  useConversationStream({
    onMessageCreated: (frame) => {
      if (frame.conversation_id !== conversationId) return;
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
  });

  const newestPage = pages[0];
  const messages = mergeMessagePages(
    pages.map((query) => query.data?.items ?? []),
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

  function loadOlder(): void {
    // A failed older page retries itself; another cursor would duplicate it.
    if (olderPage !== null && olderState === "error") {
      void olderPage.refetch();
      return;
    }
    const cursor = oldestCreatedAt(messages);
    if (cursor !== null) setCursors((current) => [...current, cursor]);
  }

  return {
    load,
    detail: detail.data ?? null,
    isRetrying: detail.isFetching || newestPage.isFetching,
    retryLoad,
    messages,
    messageState,
    hasOlder: messages.length < total,
    olderState,
    loadOlder,
    liveAfterMs,
  };
}
