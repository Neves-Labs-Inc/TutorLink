// A person's upcoming live Bookings (Pending and Confirmed), soonest first.
import { useQuery } from "@tanstack/react-query";
import { getTodayKey } from "@/components/kit/format";
import { bookingQueries } from "@/lib/queries/bookings";
import type { BookingSummary } from "@/lib/queries/bookings";
import { getUpcomingBookings } from "@/pages/staff/lib/staff-bookings";

// More than the 10 shown, so today's already-started sessions can be cut.
const FETCH_SIZE = 20;

type StaffBookings = {
  bookings: BookingSummary[] | undefined;
  hasFailed: boolean;
  isRetrying: boolean;
  retry: () => void;
};

export function useStaffBookings(userId: string): StaffBookings {
  const query = useQuery({
    ...bookingQueries.list({
      user_id: userId,
      status: ["pending", "confirmed"],
      from: getTodayKey(),
      page_size: FETCH_SIZE,
    }),
  });
  // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
  const hasFailed = !query.data && (query.isError || query.errorUpdateCount > 0);

  return {
    bookings: query.data ? getUpcomingBookings(query.data.items) : undefined,
    hasFailed,
    isRetrying: query.isFetching,
    retry: () => void query.refetch(),
  };
}
