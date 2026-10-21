// The Bookings calendar. From 768px a time grid: the week (a column per
// day) or Day by Staff (a column per Staff member, Availability shaded).
// Below that, a day agenda under a 7-day strip. Empty hours start a New
// booking there; Bookings open their details. The page owns the week,
// day, scale and filters.
import type { ReactNode } from "react";
import { CalendarX2, Info } from "lucide-react";
import CalendarSkeleton from "@/components/bookings-calendar/calendar-skeleton";
import { getDayColumns, getWeekColumns } from "@/components/bookings-calendar/calendar-columns";
import DayAgenda from "@/components/bookings-calendar/day-agenda";
import DayStrip from "@/components/bookings-calendar/day-strip";
import TimeGrid from "@/components/kit/components/time-grid";
import { formatDay, getTodayKey } from "@/components/kit/format";
import { useNow } from "@/components/kit/hooks/use-now";
import { ErrorState } from "@/components/kit/states/states";
import { cn, TONE_CLASSES } from "@/components/kit/tokens";
import { useBookingsCalendar } from "@/hooks/use-bookings-calendar";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { BookingListFilters } from "@/lib/bookings/booking-filters";
import { getBusinessTime } from "@/lib/bookings/calendar";

const WIDE_QUERY = "(min-width: 768px)";
// Day by Staff columns keep this width and scroll sideways in the card.
const STAFF_COLUMN_MIN_PX = 140;

export type NewBookingPrefill = { date: string; startTime: string; userId?: string };

type BookingsCalendarProps = {
  scale: "week" | "day";
  // Monday of the shown week, business time.
  weekStart: string;
  // The day shown in Day view and on phones.
  day: string;
  filters: BookingListFilters;
  onDayChange: (day: string) => void;
  onOpenBooking: (id: string) => void;
  onNewBooking: (prefill: NewBookingPrefill) => void;
};

function AvailabilityLegend(): ReactNode {
  return (
    <p className="flex items-center gap-2 text-[13px] text-(--tl-muted)">
      <span
        aria-hidden
        className="size-3 shrink-0 rounded-full border border-(--tl-green-ink) bg-(--tl-green-tint)"
      />
      Available (from their Availability)
    </p>
  );
}

export default function BookingsCalendar({
  scale,
  weekStart,
  day,
  filters,
  onDayChange,
  onOpenBooking,
  onNewBooking,
}: BookingsCalendarProps): ReactNode {
  const isWide = useMediaQuery(WIDE_QUERY);
  const calendar = useBookingsCalendar({ scale, weekStart, day, filters, isWide });
  const now = new Date(useNow());
  const today = getTodayKey(now);
  const { bookings, timeOff } = calendar;
  const isDayView = scale === "day";

  function handleCreateAt(columnId: string, time: string): void {
    onNewBooking(
      isDayView
        ? { date: day, startTime: time, userId: columnId }
        : { date: columnId, startTime: time },
    );
  }

  if (calendar.state === "loading") return <CalendarSkeleton isWide={isWide} />;
  if (calendar.state === "error") {
    return (
      <ErrorState
        title="Couldn’t load bookings"
        body="Check your connection and try again."
        onRetry={calendar.retry}
        isRetrying={calendar.isRetrying}
      />
    );
  }

  const columns = isDayView
    ? getDayColumns({ day, today, staff: calendar.dayStaff, bookings })
    : getWeekColumns({ weekStart, today, bookings, timeOff, userIds: filters.userIds });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {bookings.length < calendar.total && (
        <p className={cn(TONE_CLASSES.info, "flex items-center gap-2 rounded-[16px] px-4 py-3 text-[14px]")}>
          <Info aria-hidden className="size-4 shrink-0" />
          Showing the first {bookings.length} bookings this week. Narrow the
          filters to see the rest.
        </p>
      )}
      {isWide ? (
        <>
          {isDayView && (
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="w-full max-w-[520px]">
                <DayStrip
                  weekStart={weekStart}
                  day={day}
                  today={today}
                  bookings={bookings}
                  onDayChange={onDayChange}
                />
              </div>
              <AvailabilityLegend />
            </div>
          )}
          {bookings.length === 0 && (
            <p role="status" className="text-[14px] text-(--tl-muted)">
              No bookings this week.
            </p>
          )}
          {columns.length > 0 ? (
            <TimeGrid
              columns={columns}
              nowTime={getBusinessTime(now)}
              onOpen={onOpenBooking}
              onCreateAt={handleCreateAt}
              minColumnPx={isDayView ? STAFF_COLUMN_MIN_PX : undefined}
            />
          ) : (
            <p className="flex items-center gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-4 text-[14px]">
              <CalendarX2 aria-hidden className="size-4 shrink-0 text-(--tl-muted)" />
              Nobody is booked or available on {formatDay(day, { weekday: "long" })}.
            </p>
          )}
        </>
      ) : (
        <DayAgenda
          weekStart={weekStart}
          day={day}
          today={today}
          bookings={bookings}
          timeOff={timeOff}
          userIds={filters.userIds}
          onDayChange={onDayChange}
          onOpenBooking={onOpenBooking}
        />
      )}
    </div>
  );
}
