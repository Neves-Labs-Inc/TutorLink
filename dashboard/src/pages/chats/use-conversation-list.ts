// The two Conversations queries: every Needs attention chat (server
// order), then the other chats a page at a time. Both follow the same
// filters, and stream frames refetch them along with the counts.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useClampedPage } from "@/hooks/useClampedPage";
import { useConversationStream } from "@/hooks/use-conversation-stream/useConversationStream";
import { conversationQueries } from "@/lib/queries/conversations";
import type {
  Conversation,
  ConversationListParams,
} from "@/lib/queries/conversations";
import type { Page } from "@/lib/queries/page";
import type { ConversationFilters } from "@/pages/chats/use-conversation-filters";

export const ATTENTION_PAGE_SIZE = 100;
export const OTHERS_PAGE_SIZE = 20;

export type ListSection = {
  items: Conversation[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  // A new page is loading; the old rows stay on screen.
  isBusy: boolean;
  // A new page failed; the old rows stay on screen.
  hasPageError: boolean;
  retryPage: () => void;
};

type ConversationListState =
  | { status: "loading"; retry: () => void }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      attention: ListSection;
      others: ListSection;
      retry: () => void;
    };

function getFilterParams(filters: ConversationFilters): ConversationListParams {
  const q = filters.q.trim();
  return {
    ...(q && { q }),
    ...(filters.isUnread && { unread: true }),
    ...(filters.holders.length > 0 && { holder: filters.holders }),
  };
}

export function useConversationList(
  filters: ConversationFilters,
  setPage: (page: number) => void,
): ConversationListState {
  const queryClient = useQueryClient();
  const filterParams = getFilterParams(filters);
  const filterKey = JSON.stringify(filterParams);

  // Needs attention past 100 chats is unlikely; its page is not in the URL.
  const [attentionPage, setAttentionPage] = useState(1);
  // The last rows shown, kept on screen when a later page fails.
  const [shownOthers, setShownOthers] = useState<Page<Conversation> | null>(
    null,
  );
  const [shownFilterKey, setShownFilterKey] = useState(filterKey);
  if (filterKey !== shownFilterKey) {
    setShownFilterKey(filterKey);
    setAttentionPage(1);
    setShownOthers(null);
  }

  const attention = useQuery(
    conversationQueries.list({
      ...filterParams,
      flagged: true,
      ...(attentionPage > 1 && { page: attentionPage }),
      page_size: ATTENTION_PAGE_SIZE,
    }),
  );
  const others = useQuery(
    conversationQueries.list({
      ...filterParams,
      flagged: false,
      page: filters.page,
      page_size: OTHERS_PAGE_SIZE,
    }),
  );
  const clamped = useClampedPage({
    page: filters.page,
    setPage,
    data: others.data,
    isPlaceholderData: others.isPlaceholderData,
    isFetching: others.isFetching,
  });

  // Placeholder rows belong to other filters or another page.
  if (others.data && !others.isPlaceholderData && others.data !== shownOthers) {
    setShownOthers(others.data);
  }

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: ["conversations", "list"] });
    void queryClient.invalidateQueries({ queryKey: ["counts"] });
  }
  useConversationStream({
    onConversationUpdated: invalidate,
    onMessageCreated: invalidate,
  });

  function retry(): void {
    void attention.refetch();
    void others.refetch();
  }

  const othersData = others.data ?? (others.isError ? shownOthers : null);
  const isPageFailed = others.isError && !others.data;
  const isLoading =
    (attention.isPending && !attention.isError) ||
    (others.isPending && !others.isError) ||
    (clamped.outOfRange && !others.isError);
  const isError =
    (attention.isError && !attention.data) || (others.isError && !othersData);

  let state: ConversationListState;
  if (isError) {
    state = { status: "error", retry };
  } else if (isLoading || !attention.data || !othersData) {
    state = { status: "loading", retry };
  } else {
    state = {
      status: "ready",
      retry,
      attention: {
        items: attention.data.items,
        total: attention.data.total,
        page: attentionPage,
        pageSize: ATTENTION_PAGE_SIZE,
        onPageChange: setAttentionPage,
        isBusy: attention.isPlaceholderData,
        // Its later pages have no kept rows; a failure there is the full
        // error state, and a failed background refetch keeps its rows.
        hasPageError: false,
        retryPage: () => void attention.refetch(),
      },
      others: {
        items: othersData.items,
        // A failed page has no data of its own: count from the kept rows.
        total: isPageFailed ? othersData.total : clamped.pagerTotal,
        page: isPageFailed ? filters.page : clamped.pagerPage,
        pageSize: OTHERS_PAGE_SIZE,
        onPageChange: setPage,
        isBusy: others.isPlaceholderData,
        // Only a page that never arrived; a failed background refetch keeps
        // the current rows and says nothing.
        hasPageError: isPageFailed,
        retryPage: () => void others.refetch(),
      },
    };
  }
  return state;
}
