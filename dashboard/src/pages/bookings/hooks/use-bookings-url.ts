// The Bookings page's filters, view, week and page, read from and
// written to the URL. Each change is a history entry (back steps through
// them), except the search, which replaces as it is typed. A filter
// change goes back to page 1.
import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getTodayKey } from "@/components/kit/format";
import type { BookingListFilters } from "@/lib/bookings/booking-filters";
import { getWeekStart } from "@/lib/week";
import {
  KINDS,
  readBookingsUrl,
  STATUSES,
  writeBookingsUrl,
} from "@/pages/bookings/lib/bookings-url";
import type {
  BookingsUrlState,
  BookingsView,
} from "@/pages/bookings/lib/bookings-url";
import { readStoredView, storeView } from "@/pages/bookings/lib/view-memory";
import { useAuthStore } from "@/stores/authStore";

export type BookingsUrl = {
  state: BookingsUrlState;
  // What the week's queries read; Mine stands in for the Staff filter.
  filters: BookingListFilters;
  view: BookingsView;
  weekStart: string;
  currentWeek: string;
  // Something Clear all would reset is on (search included).
  activeCount: number;
  // Search or a filter narrows the week.
  isFiltered: boolean;
  setQuery: (q: string) => void;
  setKinds: (values: string[]) => void;
  setStaffIds: (values: string[]) => void;
  setChildIds: (values: string[]) => void;
  setStatuses: (values: string[]) => void;
  toggleMine: () => void;
  toggleNeedsAttention: () => void;
  setView: (view: BookingsView) => void;
  setWeek: (weekStart: string) => void;
  // Replace: a correction (page past the end), not a step back can undo.
  setPage: (page: number, isReplace?: boolean) => void;
  clearAll: () => void;
};

type Change = (current: BookingsUrlState) => BookingsUrlState;

export function useBookingsUrl(): BookingsUrl {
  const [params, setParams] = useSearchParams();
  const userId = useAuthStore((store) => store.userId);
  const [storedView] = useState(readStoredView);
  const state = readBookingsUrl(params);
  const currentWeek = getWeekStart(getTodayKey());
  const weekStart = state.week ?? currentWeek;
  // Needs attention spans every date, so it is a list.
  const view = state.isNeedsAttention ? "list" : (state.view ?? storedView);

  const update = useCallback(
    (change: Change, isReplace = false) => {
      setParams(
        (current) =>
          writeBookingsUrl(current, change(readBookingsUrl(current))),
        { replace: isReplace },
      );
    },
    [setParams],
  );

  const setQuery = useCallback(
    (q: string) => update((current) => ({ ...current, q, page: 1 }), true),
    [update],
  );

  const filters: BookingListFilters = {
    q: state.q,
    kinds: state.kinds,
    statuses: state.statuses,
    userIds: state.isMine && userId ? [userId] : state.staffIds,
    childIds: state.childIds,
  };
  const filterCount = [
    state.kinds.length > 0,
    state.staffIds.length > 0,
    state.childIds.length > 0,
    state.statuses.length > 0,
    state.isMine,
  ].filter(Boolean).length;
  const hasQuery = state.q.trim() !== "";

  return {
    state,
    filters,
    view,
    weekStart,
    currentWeek,
    activeCount:
      filterCount + (hasQuery ? 1 : 0) + (state.isNeedsAttention ? 1 : 0),
    isFiltered: filterCount > 0 || hasQuery,
    setQuery,
    setKinds: (values) =>
      update((current) => ({
        ...current,
        kinds: KINDS.filter((kind) => values.includes(kind)),
        page: 1,
      })),
    setStaffIds: (values) =>
      update((current) => ({ ...current, staffIds: values, page: 1 })),
    setChildIds: (values) =>
      update((current) => ({ ...current, childIds: values, page: 1 })),
    setStatuses: (values) =>
      update((current) => ({
        ...current,
        statuses: STATUSES.filter((status) => values.includes(status)),
        page: 1,
      })),
    toggleMine: () =>
      update((current) => ({ ...current, isMine: !current.isMine, page: 1 })),
    toggleNeedsAttention: () =>
      update((current) => ({
        ...current,
        isNeedsAttention: !current.isNeedsAttention,
        page: 1,
      })),
    setView: (next) => {
      storeView(next);
      update((current) => ({ ...current, view: next, page: 1 }));
    },
    setWeek: (next) =>
      update((current) => ({
        ...current,
        week: next === currentWeek ? null : next,
        page: 1,
      })),
    setPage: (page, isReplace = false) =>
      update((current) => ({ ...current, page }), isReplace),
    clearAll: () =>
      update((current) => ({
        ...current,
        q: "",
        kinds: [],
        staffIds: [],
        childIds: [],
        statuses: [],
        isMine: false,
        isNeedsAttention: false,
        page: 1,
      })),
  };
}
