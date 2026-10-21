// The List view's Bookings: the shown week with the filters, a page at a
// time. Paging keeps the previous page up while the next loads; a new
// week or filter shows the skeleton instead of the old rows.
import { useQuery } from "@tanstack/react-query";
import { toWeekParams } from "@/lib/bookings/booking-filters";
import type { BookingListFilters } from "@/lib/bookings/booking-filters";
import { bookingQueries } from "@/lib/queries/bookings";
import type { BookingListParams, BookingSummary } from "@/lib/queries/bookings";

export const WEEK_LIST_PAGE_SIZE = 50;

export type WeekListState =
  | { status: "loading" }
  | { status: "error"; retry: () => void; isRetrying: boolean }
  | {
      status: "ready";
      bookings: BookingSummary[];
      total: number;
      lastPage: number;
      // The rows shown are the previous page's while this one loads.
      isPaging: boolean;
    };

type WeekListOptions = {
  weekStart: string;
  filters: BookingListFilters;
  page: number;
  isEnabled: boolean;
};

// The query's params as text, page aside (stringify drops undefined).
function withoutPage(params: unknown): string {
  // The list key's params are a BookingListParams object.
  return JSON.stringify({ ...(params as BookingListParams), page: undefined });
}

export function useWeekList({
  weekStart,
  filters,
  page,
  isEnabled,
}: WeekListOptions): WeekListState {
  const params: BookingListParams = {
    ...toWeekParams(weekStart, filters),
    page,
    page_size: WEEK_LIST_PAGE_SIZE,
  };
  const query = useQuery({
    ...bookingQueries.list(params),
    enabled: isEnabled,
    placeholderData: (previous, previousQuery) =>
      previousQuery &&
      withoutPage(previousQuery.queryKey[2]) === withoutPage(params)
        ? previous
        : undefined,
  });

  // With no data to show, TanStack puts a failed query back to pending
  // while Try again runs; errorUpdatedAt keeps the error card up.
  const hasFailed = !query.data && query.errorUpdatedAt > 0;

  let state: WeekListState;
  if (query.data) {
    state = {
      status: "ready",
      bookings: query.data.items,
      total: query.data.total,
      lastPage: Math.max(1, Math.ceil(query.data.total / WEEK_LIST_PAGE_SIZE)),
      isPaging: query.isPlaceholderData,
    };
  } else if (hasFailed) {
    state = {
      status: "error",
      retry: () => void query.refetch(),
      isRetrying: query.isFetching,
    };
  } else {
    state = { status: "loading" };
  }
  return state;
}
