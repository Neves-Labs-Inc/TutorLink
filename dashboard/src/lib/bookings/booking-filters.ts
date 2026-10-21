// The Bookings page's search and filters, as the calendar and list read
// them. An empty list means "no filter on this field".
import type {
  BookingKind,
  BookingStatus,
  BookingWeekParams,
} from "@/lib/queries/bookings";
import { addDays } from "@/lib/week";

const LAST_DAY_OFFSET = 6;

export type BookingListFilters = {
  q: string;
  kinds: BookingKind[];
  statuses: BookingStatus[];
  // Staff user ids.
  userIds: string[];
  childIds: string[];
};

// The week's Bookings query: Monday to Sunday plus the filters. With no
// Status picked every status comes back, so cancelled ones show muted.
export function toWeekParams(
  weekStart: string,
  filters: BookingListFilters,
): BookingWeekParams {
  const query = filters.q.trim();
  return {
    from: weekStart,
    to: addDays(weekStart, LAST_DAY_OFFSET),
    kind: filters.kinds,
    status: filters.statuses,
    user_id: filters.userIds,
    child_id: filters.childIds,
    ...(query ? { q: query } : {}),
  };
}
