// The Staff list's state, kept in the URL so details can close back to
// the same tab, search and filters (and a reload keeps them): `list`
// (the Archived tab), `q`, `role` and `sign_in` (repeated keys).
import { useEffect, useEffectEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router-dom";
import type { FilterOption } from "@/components/kit/components/multi-select-filter";
import { staffDirectoryQueries } from "@/lib/queries/staff";
import type {
  SignInStateWire,
  StaffRead,
  StaffRole,
} from "@/lib/queries/staff";

export type StaffListTab = "current" | "archived";

// The list's own path; details live under it at `/staff/:id`.
const LIST_PATH = "/staff";
const LIST_PARAM = "list";
const QUERY_PARAM = "q";
const ROLE_PARAM = "role";
const SIGN_IN_PARAM = "sign_in";
// Typing waits this long before the URL (and the server search) follow.
const SEARCH_DEBOUNCE_MS = 250;
// Details' own param; the list never reads or keeps it.
const DETAILS_TAB_PARAM = "tab";

type Option<T extends string> = FilterOption & { value: T };

export const ROLE_OPTIONS: Option<StaffRole>[] = [
  { value: "tutor", label: "Tutors" },
  { value: "manager", label: "Managers" },
  { value: "admin", label: "Admins" },
];

export const SIGN_IN_OPTIONS: Option<SignInStateWire>[] = [
  { value: "not_invited", label: "Not invited" },
  { value: "invited", label: "Invited" },
  { value: "active", label: "Active" },
];

// Only the values an option offers; anything else in the URL is dropped.
function readValues<T extends string>(
  search: URLSearchParams,
  key: string,
  options: Option<T>[],
): T[] {
  return search
    .getAll(key)
    .flatMap((value) => options.filter((option) => option.value === value))
    .map((option) => option.value);
}

type StaffList = {
  tab: StaffListTab;
  changeTab: (tab: StaffListTab) => void;
  query: string;
  setQuery: (query: string) => void;
  roles: StaffRole[];
  setRoles: (roles: string[]) => void;
  signInStates: SignInStateWire[];
  setSignInStates: (states: string[]) => void;
  activeFilterCount: number;
  clearFilters: () => void;
  isNarrowed: boolean;
  rows: StaffRead[] | undefined;
  hasFailed: boolean;
  isRetrying: boolean;
  retry: () => void;
  counts: Record<StaffListTab, number | undefined>;
  // The list's part of the URL ("?list=archived&q=an"), for details to return to.
  listSearch: string;
};

export function useStaffList(): StaffList {
  const [search, setSearch] = useSearchParams();
  const { pathname } = useLocation();
  const tab: StaffListTab =
    search.get(LIST_PARAM) === "archived" ? "archived" : "current";
  const urlQuery = search.get(QUERY_PARAM) ?? "";
  // The box keeps its own text: the router applies URL changes in a
  // transition, which can't drive a text input (the caret jumps, fast
  // keys drop).
  const [query, setQuery] = useState(urlQuery);
  const [writtenQuery, setWrittenQuery] = useState(urlQuery);
  const [syncedUrlQuery, setSyncedUrlQuery] = useState(urlQuery);
  // The URL moved without us (tab change, Back): the box follows it.
  if (urlQuery !== syncedUrlQuery) {
    setSyncedUrlQuery(urlQuery);
    if (urlQuery !== writtenQuery) setQuery(urlQuery);
  }
  const roles = readValues(search, ROLE_PARAM, ROLE_OPTIONS);
  const signInStates = readValues(search, SIGN_IN_PARAM, SIGN_IN_OPTIONS);
  const activeFilterCount = [roles, signInStates].filter(
    (values) => values.length > 0,
  ).length;

  const list = useQuery(
    staffDirectoryQueries.list({
      archived: tab === "archived",
      roles,
      signInStates,
      q: urlQuery,
    }),
  );
  const currentCount = useQuery(staffDirectoryQueries.count(false));
  const archivedCount = useQuery(staffDirectoryQueries.count(true));

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

  function setValues(key: string, values: string[]): void {
    update((next) => {
      next.delete(key);
      for (const value of values) next.append(key, value);
    });
  }

  function clearFilters(): void {
    update((next) => {
      next.delete(ROLE_PARAM);
      next.delete(SIGN_IN_PARAM);
    });
  }

  // Runs with this render's params and path, not the keystroke's: a
  // filter picked or a row opened during the pause must survive it.
  const writeQuery = useEffectEvent((text: string) => {
    setWrittenQuery(text);
    update((params) => {
      if (text === "") params.delete(QUERY_PARAM);
      else params.set(QUERY_PARAM, text);
    });
  });

  // Details opened mid-pause hold the write until they close.
  const isOnList = pathname === LIST_PATH;
  useEffect(() => {
    if (!isOnList || query === urlQuery) return;
    const timer = setTimeout(() => writeQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // Only new text or a return to the list restarts the wait.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, isOnList]);

  // A new tab starts clean: no search, no filters.
  function changeTab(next: StaffListTab): void {
    setQuery("");
    setSearch(next === "archived" ? { [LIST_PARAM]: "archived" } : {}, {
      replace: true,
    });
  }

  const listParams = new URLSearchParams(search);
  listParams.delete(DETAILS_TAB_PARAM);
  const listSearch = listParams.size > 0 ? `?${listParams.toString()}` : "";

  return {
    tab,
    changeTab,
    query,
    setQuery,
    roles,
    setRoles: (values) => setValues(ROLE_PARAM, values),
    signInStates,
    setSignInStates: (values) => setValues(SIGN_IN_PARAM, values),
    activeFilterCount,
    clearFilters,
    isNarrowed: urlQuery.trim() !== "" || activeFilterCount > 0,
    rows: list.data?.items,
    // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
    hasFailed: !list.data && (list.isError || list.errorUpdateCount > 0),
    isRetrying: list.isFetching,
    retry: () => void list.refetch(),
    counts: { current: currentCount.data, archived: archivedCount.data },
    listSearch,
  };
}
