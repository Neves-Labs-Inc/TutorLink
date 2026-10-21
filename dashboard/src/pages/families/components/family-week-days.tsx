// A loaded week with Bookings: from 768px of the section's own width a
// 7-day grid, below that a day-by-day list. Both render; `hidden` keeps
// the unused one out of the accessibility tree.
import type { ReactNode } from "react";
import BookingBlock from "@/components/kit/components/booking-block";
import type { ChildTone } from "@/components/kit/lib/child-tones";
import { cn } from "@/components/kit/tokens";
import { useBookingOverlays } from "@/hooks/use-booking-overlays";
import { getBookingsOn, getWeekDays } from "@/lib/bookings/calendar";
import type { BookingSummary } from "@/lib/queries/bookings";
import {
  formatGridDay,
  formatListDay,
  toWeekBlock,
} from "@/pages/families/lib/family-week";

type FamilyWeekDaysProps = {
  weekStart: string;
  today: string;
  bookings: BookingSummary[];
  tones: Map<string, ChildTone>;
};

export default function FamilyWeekDays({
  weekStart,
  today,
  bookings,
  tones,
}: FamilyWeekDaysProps): ReactNode {
  const { openBooking } = useBookingOverlays();
  const days = getWeekDays(weekStart).map((day) => ({
    day,
    isToday: day === today,
    bookings: getBookingsOn(bookings, day),
  }));

  function renderBlocks(dayBookings: BookingSummary[]): ReactNode {
    return dayBookings.map((booking) => (
      <BookingBlock
        key={booking.id}
        layout="stack"
        {...toWeekBlock(booking, tones.get(booking.child.id) ?? "neutral")}
        onOpen={() => openBooking(booking.id)}
      />
    ));
  }

  return (
    <>
      <ol className="mt-3 hidden grid-cols-7 gap-1.5 @3xl:grid">
        {days.map(({ day, isToday, bookings: dayBookings }) => (
          <li
            key={day}
            className={cn(
              "flex min-h-40 min-w-0 flex-col gap-1.5 rounded-[14px] p-1.5",
              isToday ? "bg-(--tl-tint)" : "bg-(--tl-surface-sunk)",
            )}
          >
            <p
              className={cn(
                "px-1 text-[12px] font-semibold",
                isToday ? "text-(--tl-primary-ink)" : "text-(--tl-muted)",
              )}
            >
              {formatGridDay(day)}
              {isToday && <span className="sr-only"> (today)</span>}
            </p>
            {renderBlocks(dayBookings)}
          </li>
        ))}
      </ol>
      <ol className="mt-3 flex flex-col gap-3 @3xl:hidden">
        {days.map(({ day, isToday, bookings: dayBookings }) => (
          <li key={day} className="flex gap-3">
            <p
              className={cn(
                "w-[72px] shrink-0 pt-2 text-[13px] leading-5 font-semibold",
                isToday ? "text-(--tl-primary-ink)" : "text-(--tl-muted)",
              )}
            >
              {formatListDay(day)}
              {isToday && <span className="block text-[12px] font-normal">Today</span>}
            </p>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              {dayBookings.length === 0 ? (
                <p className="pt-2 text-[13px] text-(--tl-muted)">—</p>
              ) : (
                renderBlocks(dayBookings)
              )}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}
