// The family's Bookings one Monday-to-Sunday week at a time, opening on
// the business's current week. Weeks load through the shared week hook,
// so neighbours are preloaded and visited weeks stay cached.
import { useState } from "react";
import { getTodayKey } from "@/components/kit/format";
import { useNow } from "@/components/kit/hooks/use-now";
import { useWeekQueries } from "@/hooks/use-week-queries";
import { bookingQueries } from "@/lib/queries/bookings";
import type { BookingSummary } from "@/lib/queries/bookings";
import { getWeekEnd } from "@/pages/families/lib/family-week";
import { addWeeks, getWeekStart } from "@/lib/week";

export type FamilyWeekState = "loading" | "error" | "empty" | "ready";

export type FamilyWeek = {
  weekStart: string;
  today: string;
  isThisWeek: boolean;
  state: FamilyWeekState;
  bookings: BookingSummary[];
  isRetrying: boolean;
  retry: () => void;
  showPreviousWeek: () => void;
  showNextWeek: () => void;
  showThisWeek: () => void;
};

export function useFamilyWeek(childIds: string[]): FamilyWeek {
  const today = getTodayKey(new Date(useNow()));
  const thisWeek = getWeekStart(today);
  const [weekStart, setWeekStart] = useState(thisWeek);
  // With no Child the list would come back unfiltered: every Booking.
  const hasChildren = childIds.length > 0;
  const query = useWeekQueries(weekStart, (week) => ({
    ...bookingQueries.week({ child_id: childIds, from: week, to: getWeekEnd(week) }),
    enabled: hasChildren,
  }));

  const bookings = query.data?.items ?? [];
  // TanStack puts a failed query with no data back to pending while it
  // retries; the error timestamp keeps the error up meanwhile.
  const hasFailed = !query.data && query.errorUpdatedAt > 0;
  let state: FamilyWeekState = "ready";
  if (!hasChildren) {
    state = "empty";
  } else if (hasFailed) {
    state = "error";
  } else if (query.isPending) {
    state = "loading";
  } else if (bookings.length === 0) {
    state = "empty";
  }

  return {
    weekStart,
    today,
    isThisWeek: weekStart === thisWeek,
    state,
    bookings,
    isRetrying: hasFailed && query.isFetching,
    retry: () => void query.refetch(),
    showPreviousWeek: () => setWeekStart((week) => addWeeks(week, -1)),
    showNextWeek: () => setWeekStart((week) => addWeeks(week, 1)),
    showThisWeek: () => setWeekStart(thisWeek),
  };
}
