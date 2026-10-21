// The Admin queue's state, kept in the URL so the details close back to
// the same tab, search, Role filter and page (and a reload keeps them):
// `tab`, `q`, `role` (repeated) and `page`.
//
// The API can't filter by role or name, nor say "ended" for a decided
// row, so the queue reads its rows whole and places, filters and pages
// them here: the live tabs from every not-ended row (`from=today`), Past
// from every row that has started (`to=today`), each placed by
// `getQueueTab`.
import { useEffect, useEffectEvent, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router-dom";
import { getTodayKey } from "@/components/kit/format";
import type { FilterOption } from "@/components/kit/components/multi-select-filter";
import type { Role } from "@/lib/auth/auth";
import { timeOffQueries } from "@/lib/queries/time-off";
import type { ExceptionRead, TimeOffStatus } from "@/lib/queries/time-off";
import { sortQueueTab } from "@/pages/time-off/lib/time-off-lists";
import { getBusinessNow, getQueueTab } from "@/pages/time-off/lib/time-off-rules";
import type { QueueTab } from "@/pages/time-off/lib/time-off-rules";
import { useTimeOffDecisionStore } from "@/stores/time-off-decision-store";

export const QUEUE_PAGE_SIZE = 25;
export const TIME_OFF_PATH = "/time-off";

const TAB_PARAM = "tab";
const QUERY_PARAM = "q";
const ROLE_PARAM = "role";
const PAGE_PARAM = "page";
// Typing waits this long before the URL (and the rows) follow.
const SEARCH_DEBOUNCE_MS = 250;
// Expired is a pending row that has ended: never in a live tab.
const LIVE_STATUSES: TimeOffStatus[] = ["pending", "approved", "rejected", "cancelled"];

export const QUEUE_TABS: { id: QueueTab; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "upcoming", label: "Upcoming" },
  { id: "declined-cancelled", label: "Declined & cancelled" },
  { id: "past", label: "Past" },
];

type RoleOption = FilterOption & { value: Role };

export const ROLE_OPTIONS: RoleOption[] = [
  { value: "tutor", label: "Tutors" },
  { value: "manager", label: "Managers" },
  { value: "admin", label: "Admins" },
];

function readTab(search: URLSearchParams): QueueTab {
  const value = search.get(TAB_PARAM);
  return QUEUE_TABS.find((tab) => tab.id === value)?.id ?? "pending";
}

// Only the roles an option offers; anything else in the URL is dropped.
function readRoles(search: URLSearchParams): Role[] {
  return ROLE_OPTIONS.filter((option) =>
    search.getAll(ROLE_PARAM).includes(option.value),
  ).map((option) => option.value);
}

function readPage(search: URLSearchParams): number {
  const page = Number(search.get(PAGE_PARAM));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

// The list's URL for `tab`, keeping the search and filter, from page 1.
export function getTabSearch(current: URLSearchParams, tab: QueueTab): string {
  const next = new URLSearchParams(current);
  next.delete(PAGE_PARAM);
  if (tab === "pending") next.delete(TAB_PARAM);
  else next.set(TAB_PARAM, tab);
  return next.size > 0 ? `?${next.toString()}` : "";
}

function matches(item: ExceptionRead, roles: Role[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    (roles.length === 0 || roles.includes(item.staff.role)) &&
    item.staff.name.toLowerCase().includes(needle)
  );
}

// An Approve or Decline waiting behind its Undo is already in the
// details cache, but a list read meanwhile still says Pending: show the
// decided row until the act commits or is undone.
function useWithQueuedDecisions(items: ExceptionRead[] | undefined): ExceptionRead[] | undefined {
  const client = useQueryClient();
  const queuedIds = useTimeOffDecisionStore((state) => state.queuedIds);
  return items?.map((item) =>
    queuedIds.has(item.id)
      ? (client.getQueryData(timeOffQueries.detail(item.id).queryKey) ?? item)
      : item,
  );
}

export type TimeOffQueue = {
  tab: QueueTab;
  changeTab: (tab: QueueTab) => void;
  query: string;
  setQuery: (query: string) => void;
  roles: Role[];
  setRoles: (roles: string[]) => void;
  clearFilters: () => void;
  isNarrowed: boolean;
  // Undefined while the tab's rows load.
  rows: ExceptionRead[] | undefined;
  total: number;
  page: number;
  setPage: (page: number) => void;
  pendingCount: number | undefined;
  hasFailed: boolean;
  isRetrying: boolean;
  retry: () => void;
};

export function useTimeOffQueue(): TimeOffQueue {
  const [search, setSearch] = useSearchParams();
  const { pathname } = useLocation();
  const tab = readTab(search);
  const roles = readRoles(search);
  const urlQuery = search.get(QUERY_PARAM) ?? "";
  // The box keeps its own text: the router applies URL changes in a
  // transition, which can't drive a text input (the caret jumps, fast
  // keys drop).
  const [query, setQuery] = useState(urlQuery);
  const [writtenQuery, setWrittenQuery] = useState(urlQuery);
  const [syncedUrlQuery, setSyncedUrlQuery] = useState(urlQuery);
  // The URL moved without us (Back, a reload): the box follows it.
  if (urlQuery !== syncedUrlQuery) {
    setSyncedUrlQuery(urlQuery);
    if (urlQuery !== writtenQuery) setQuery(urlQuery);
  }

  const today = getTodayKey();
  const live = useQuery(timeOffQueries.listAll({ status: LIVE_STATUSES, from: today }));
  const past = useQuery({
    ...timeOffQueries.listAll({ to: today }),
    enabled: tab === "past",
  });
  const source = tab === "past" ? past : live;
  const now = getBusinessNow();
  const liveItems = useWithQueuedDecisions(live.data?.items);
  const sourceItems = useWithQueuedDecisions(source.data?.items);

  const inTab = sourceItems?.filter((item) => getQueueTab(item, now) === tab);
  const matching = inTab && sortQueueTab(inTab, tab).filter((item) => matches(item, roles, urlQuery));
  const total = matching?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
  // A page past the end (rows decided away, a narrower search) shows the last.
  const page = Math.min(readPage(search), pageCount);
  const start = (page - 1) * QUEUE_PAGE_SIZE;

  function update(change: (next: URLSearchParams) => void): void {
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        change(next);
        return next;
      },
      { replace: true },
    );
  }

  // Any narrowing starts again from page 1.
  function setRoles(values: string[]): void {
    update((next) => {
      next.delete(ROLE_PARAM);
      next.delete(PAGE_PARAM);
      for (const value of values) next.append(ROLE_PARAM, value);
    });
  }

  function clearFilters(): void {
    update((next) => {
      next.delete(ROLE_PARAM);
      next.delete(PAGE_PARAM);
    });
  }

  // Runs with this render's params, not the keystroke's: a filter picked
  // during the pause must survive it.
  const writeQuery = useEffectEvent((text: string) => {
    setWrittenQuery(text);
    update((next) => {
      next.delete(PAGE_PARAM);
      if (text === "") next.delete(QUERY_PARAM);
      else next.set(QUERY_PARAM, text);
    });
  });

  // Details opened mid-pause hold the write until they close.
  const isOnList = pathname === TIME_OFF_PATH;
  useEffect(() => {
    if (!isOnList || query === urlQuery) return;
    const timer = setTimeout(() => writeQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Only new text or a return to the list restarts the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isOnList]);

  return {
    tab,
    changeTab: (next) => setSearch(getTabSearch(search, next), { replace: true }),
    query,
    setQuery,
    roles,
    setRoles,
    clearFilters,
    isNarrowed: urlQuery.trim() !== "" || roles.length > 0,
    rows: matching?.slice(start, start + QUEUE_PAGE_SIZE),
    total,
    page,
    setPage: (next) =>
      update((params) => {
        if (next === 1) params.delete(PAGE_PARAM);
        else params.set(PAGE_PARAM, String(next));
      }),
    pendingCount: liveItems?.filter((item) => getQueueTab(item, now) === "pending").length,
    // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
    hasFailed: !source.data && (source.isError || source.errorUpdateCount > 0),
    isRetrying: source.isFetching,
    retry: () => void source.refetch(),
  };
}
