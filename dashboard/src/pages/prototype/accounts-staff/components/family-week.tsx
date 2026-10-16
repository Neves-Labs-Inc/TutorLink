// The family's Bookings, one Monday-to-Sunday week at a time, past and
// upcoming, opening on the current week. From 768px a 7-day grid; below
// that a day-by-day list for the same week (no sideways scroll).
import { useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";
import { Button, IconButton } from "@/components/kit/components/button";
import { useToast } from "@/components/kit/overlays/use-toast";
import BookingBlock from "@/pages/prototype/accounts-staff/components/booking-block";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { DOT_CLASSES } from "@/pages/prototype/accounts-staff/lib/child-tones";
import type { ChildTone } from "@/pages/prototype/accounts-staff/lib/child-tones";
import {
  formatShortDate,
  formatWeekdayDate,
} from "@/pages/prototype/accounts-staff/lib/labels";
import { listFamilyBookings } from "@/pages/prototype/accounts-staff/lib/mock-api";
import { TODAY } from "@/pages/prototype/accounts-staff/lib/mock-data";
import {
  getWeekDays,
  getWeekEnd,
  getWeekStart,
  shiftWeek,
} from "@/pages/prototype/accounts-staff/lib/week";
import type { NamedRef } from "@/pages/prototype/accounts-staff/types/api";

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type FamilyWeekProps = {
  childRefs: NamedRef[];
  tones: Map<string, ChildTone>;
  onOpenBooking: (id: string) => void;
};

export default function FamilyWeek({ childRefs, tones, onOpenBooking }: FamilyWeekProps): ReactNode {
  const { db } = useArea();
  const { showToast } = useToast();
  const thisWeek = getWeekStart(TODAY);
  const [weekStart, setWeekStart] = useState(thisWeek);
  const days = getWeekDays(weekStart);
  const weekEnd = getWeekEnd(weekStart);
  const bookings = listFamilyBookings(db, childRefs.map((child) => child.id), weekStart, weekEnd);
  const isThisWeek = weekStart === thisWeek;
  const range = `${formatShortDate(weekStart)} – ${formatShortDate(weekEnd)}`;

  function getTone(childId: string): ChildTone {
    return tones.get(childId) ?? "primary";
  }

  function getDayBookings(day: string): typeof bookings {
    return bookings.filter((booking) => booking.scheduled_date === day);
  }

  return (
    <section aria-labelledby="family-week" className="@container">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="family-week" className={EYEBROW}>
          Bookings by week
        </h2>
        <Button variant="ghost" onClick={() => showToast({ tone: "info", message: "Opens Bookings filtered to this family’s Children." })}>
          See all in Bookings
        </Button>
      </div>
      <div className={cn(CARD, "p-3 @2xl:p-4")}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label="Previous week" onClick={() => setWeekStart(shiftWeek(weekStart, -1))} />
            <p className="min-w-[132px] text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
              {range}
            </p>
            <IconButton icon={ChevronRight} label="Next week" onClick={() => setWeekStart(shiftWeek(weekStart, 1))} />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {childRefs.length > 1 &&
              childRefs.map((child) => (
                <span key={child.id} className="flex items-center gap-1.5 text-[13px] text-(--tl-ink-soft)">
                  <span aria-hidden className={cn("size-2.5 rounded-full", DOT_CLASSES[getTone(child.id)])} />
                  {child.name.split(" ")[0]}
                </span>
              ))}
            <Button onClick={() => setWeekStart(thisWeek)} disabled={isThisWeek}>
              This week
            </Button>
          </div>
        </div>

        {bookings.length === 0 ? (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-10 text-center">
            <CalendarDays aria-hidden className="size-6 text-(--tl-muted)" />
            <p className="text-[15px] font-semibold">Nothing booked this week</p>
            <p className="text-[14px] text-(--tl-muted)">Try another week, or book from New booking.</p>
          </div>
        ) : (
          <>
            {/* Wide: a 7-day grid. */}
            <ol className="mt-3 hidden grid-cols-7 gap-1.5 @3xl:grid">
              {days.map((day, index) => {
                const isToday = day === TODAY;
                return (
                  <li key={day} className={cn("flex min-h-40 flex-col gap-1.5 rounded-[14px] p-1.5", isToday ? "bg-(--tl-tint)" : "bg-(--tl-surface-sunk)")}>
                    <p className={cn("px-1 text-[12px] font-semibold", isToday ? "text-(--tl-primary-ink)" : "text-(--tl-muted)")}>
                      {WEEKDAY_SHORT[index]} {day.slice(8).replace(/^0/, "")}
                      {isToday && <span className="sr-only"> (today)</span>}
                    </p>
                    {getDayBookings(day).map((booking) => (
                      <BookingBlock key={booking.id} booking={booking} tone={getTone(booking.child.id)} onOpen={onOpenBooking} />
                    ))}
                  </li>
                );
              })}
            </ol>
            {/* Narrow: the same week, day by day. */}
            <ol className="mt-3 flex flex-col gap-3 @3xl:hidden">
              {days.map((day) => {
                const dayBookings = getDayBookings(day);
                const isToday = day === TODAY;
                return (
                  <li key={day} className="flex gap-3">
                    <p className={cn("w-[72px] shrink-0 pt-2 text-[13px] leading-5 font-semibold", isToday ? "text-(--tl-primary-ink)" : "text-(--tl-muted)")}>
                      {formatWeekdayDate(day).replace(",", "")}
                      {isToday && <span className="block text-[12px] font-normal">Today</span>}
                    </p>
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      {dayBookings.length === 0 ? (
                        <p className="pt-2 text-[13px] text-(--tl-muted)">—</p>
                      ) : (
                        dayBookings.map((booking) => (
                          <BookingBlock key={booking.id} booking={booking} tone={getTone(booking.child.id)} onOpen={onOpenBooking} />
                        ))
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
