// The Conversations filters live in the URL (q, unread, with, page), so
// they survive opening and closing a chat and the browser's back button.
// Every filter change goes back to page 1.
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { ConversationListParams } from "@/lib/queries/conversations";

export type ChatHolder = NonNullable<ConversationListParams["holder"]>[number];

export type ConversationFilters = {
  q: string;
  isUnread: boolean;
  holders: ChatHolder[];
  page: number;
};

type ConversationFiltersState = {
  filters: ConversationFilters;
  // Unread and With: what "Clear all" clears. The search has its own clear.
  activeFilterCount: number;
  // Any of search, Unread or With is on.
  isFiltered: boolean;
  setQuery: (q: string) => void;
  toggleUnread: () => void;
  setHolders: (holders: string[]) => void;
  clearFilters: () => void;
  setPage: (page: number) => void;
};

const HOLDERS: ChatHolder[] = ["bot", "mine", "others"];
const FILTER_KEYS = ["q", "unread", "with", "page"] as const;

function isHolder(value: string): value is ChatHolder {
  return (HOLDERS as string[]).includes(value);
}

function readPage(raw: string | null): number {
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function readFilters(params: URLSearchParams): ConversationFilters {
  return {
    q: params.get("q") ?? "",
    isUnread: params.get("unread") === "1",
    holders: params.getAll("with").filter(isHolder),
    page: readPage(params.get("page")),
  };
}

function writeFilters(
  params: URLSearchParams,
  filters: ConversationFilters,
): URLSearchParams {
  const next = new URLSearchParams(params);
  FILTER_KEYS.forEach((key) => next.delete(key));
  if (filters.q) next.set("q", filters.q);
  if (filters.isUnread) next.set("unread", "1");
  filters.holders.forEach((holder) => next.append("with", holder));
  if (filters.page > 1) next.set("page", String(filters.page));
  return next;
}

export function useConversationFilters(): ConversationFiltersState {
  const [params, setParams] = useSearchParams();
  const filters = readFilters(params);

  // Replace, not push: back from a chat lands on the list as it was,
  // not on each filter step.
  const update = useCallback(
    (change: (current: ConversationFilters) => ConversationFilters) => {
      setParams(
        (current) => writeFilters(current, change(readFilters(current))),
        {
          replace: true,
        },
      );
    },
    [setParams],
  );

  const setPage = useCallback(
    (page: number) => update((current) => ({ ...current, page })),
    [update],
  );

  // Stable, so the search box's debounce timer isn't restarted by renders.
  const setQuery = useCallback(
    (q: string) => update((current) => ({ ...current, q, page: 1 })),
    [update],
  );

  const activeFilterCount =
    (filters.isUnread ? 1 : 0) + (filters.holders.length > 0 ? 1 : 0);

  return {
    filters,
    activeFilterCount,
    isFiltered: activeFilterCount > 0 || filters.q.trim() !== "",
    setQuery,
    toggleUnread: () =>
      update((current) => ({
        ...current,
        isUnread: !current.isUnread,
        page: 1,
      })),
    setHolders: (holders) =>
      update((current) => ({
        ...current,
        holders: holders.filter(isHolder),
        page: 1,
      })),
    clearFilters: () =>
      update((current) => ({
        ...current,
        isUnread: false,
        holders: [],
        page: 1,
      })),
    setPage,
  };
}
