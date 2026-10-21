// Everything the Bookings calendar reads: the week's Bookings and
// approved Time off (both preloaded a week either side), and for Day by
// Staff the active Staff and each one's Availability.
import { useQueries, useQuery } from "@tanstack/react-query";
import { useWeekQueries } from "@/hooks/use-week-queries";
import { toWeekParams } from "@/lib/bookings/booking-filters";
import type { BookingListFilters } from "@/lib/bookings/booking-filters";
import { getDayStaff } from "@/lib/bookings/calendar";
import type { DayStaff } from "@/lib/bookings/calendar";
import { availabilityQueries } from "@/lib/queries/availability";
import type { AvailabilitySlot } from "@/lib/queries/availability";
import { bookingQueries } from "@/lib/queries/bookings";
import type { BookingSummary } from "@/lib/queries/bookings";
import { officeTimeOffQueries } from "@/lib/queries/exceptions";
import type { OfficeTimeOff } from "@/lib/queries/exceptions";
import { staffQueries } from "@/lib/queries/staff";
import { addDays } from "@/lib/week";

const LAST_DAY_OFFSET = 6;

export type CalendarState = "loading" | "error" | "ready";

type BookingsCalendarData = {
  state: CalendarState;
  bookings: BookingSummary[];
  // How many Bookings the week holds; more than `bookings` when cut short.
  total: number;
  timeOff: OfficeTimeOff[];
  // The Day by Staff columns for `day`; [] outside Day view.
  dayStaff: DayStaff[];
  isRetrying: boolean;
  retry: () => void;
};

type CalendarQuery = {
  scale: "week" | "day";
  weekStart: string;
  day: string;
  filters: BookingListFilters;
  // Day by Staff only renders on wide screens; phones skip its reads.
  isWide: boolean;
};

export function useBookingsCalendar({
  scale,
  weekStart,
  day,
  filters,
  isWide,
}: CalendarQuery): BookingsCalendarData {
  const bookingsQuery = useWeekQueries(weekStart, (week) =>
    bookingQueries.week(toWeekParams(week, filters)),
  );
  const timeOffQuery = useWeekQueries(weekStart, (week) =>
    officeTimeOffQueries.approved(week, addDays(week, LAST_DAY_OFFSET)),
  );

  const isDayView = scale === "day" && isWide;
  const staffQuery = useQuery({ ...staffQueries.active(), enabled: isDayView });
  const teachers = (staffQuery.data?.items ?? []).flatMap((person) =>
    person.tutor_id ? [person.tutor_id] : [],
  );
  const slotResults = useQueries({
    queries: teachers.map((tutorId) => ({
      ...availabilityQueries.forTutor(tutorId),
      enabled: isDayView,
    })),
  });
  const availability = new Map<string, AvailabilitySlot[]>(
    teachers.map((tutorId, index) => [
      tutorId,
      slotResults[index].data?.items ?? [],
    ]),
  );

  const bookings = bookingsQuery.data?.items ?? [];
  const timeOff = timeOffQuery.data?.items ?? [];
  // TanStack puts a query with no data back to pending while it refetches,
  // so "failed with nothing to show" is read from the error timestamp:
  // the error card then stays up, retrying, instead of a skeleton.
  const queries = [bookingsQuery, timeOffQuery];
  const failed = queries.filter((query) => !query.data && query.errorUpdatedAt > 0);
  let state: CalendarState = "ready";
  if (failed.length > 0) {
    state = "error";
  } else if (queries.some((query) => query.isPending)) {
    state = "loading";
  }

  function retry(): void {
    for (const query of failed) {
      void query.refetch();
    }
  }

  return {
    state,
    bookings,
    total: bookingsQuery.data?.total ?? 0,
    timeOff,
    dayStaff: isDayView
      ? getDayStaff({
          day,
          bookings,
          activeStaff: staffQuery.data?.items ?? null,
          timeOff,
          availability,
          userIds: filters.userIds,
        })
      : [],
    isRetrying: failed.some((query) => query.isFetching),
    retry,
  };
}
