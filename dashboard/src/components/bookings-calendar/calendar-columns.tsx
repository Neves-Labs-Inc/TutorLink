// The kit TimeGrid's columns for the two wide views: a column per day
// (week) or per Staff member (Day by Staff).
import { ArchivedBadge, Avatar } from "@/components/kit/components/badges";
import type { GridColumn } from "@/components/kit/components/time-grid";
import { formatDay } from "@/components/kit/format";
import { cn, EYEBROW } from "@/components/kit/tokens";
import {
  getBookingsOn,
  getFirstName,
  getTimeOffOn,
  getWeekDays,
  toGridBlock,
} from "@/lib/bookings/calendar";
import type { DayStaff } from "@/lib/bookings/calendar";
import { formatTime } from "@/lib/dates/dates";
import type { BookingSummary } from "@/lib/queries/bookings";
import type { OfficeTimeOff } from "@/lib/queries/exceptions";

function formatShortDay(day: string): string {
  return formatDay(day, { weekday: "short", month: "short", day: "numeric" });
}

type WeekColumnsInput = {
  weekStart: string;
  today: string;
  bookings: BookingSummary[];
  timeOff: OfficeTimeOff[];
  userIds: string[];
};

export function getWeekColumns({
  weekStart,
  today,
  bookings,
  timeOff,
  userIds,
}: WeekColumnsInput): GridColumn[] {
  return getWeekDays(weekStart).map((day) => {
    const isToday = day === today;
    return {
      id: day,
      isToday,
      hasNow: isToday,
      header: (
        <span className="flex flex-col items-center">
          <span className={EYEBROW}>{formatDay(day, { weekday: "short" })}</span>
          <span
            className={cn(
              "kit-display mt-0.5 inline-flex size-9 items-center justify-center rounded-full text-[18px] font-bold",
              isToday && "bg-(--tl-primary) text-(--tl-on-primary)",
            )}
          >
            {formatDay(day, { day: "numeric" })}
          </span>
          {isToday && <span className="sr-only">(today)</span>}
        </span>
      ),
      blocks: getBookingsOn(bookings, day).map((booking) =>
        toGridBlock(booking, true),
      ),
      timeOff: getTimeOffOn(timeOff, day, userIds).map((off) => ({
        id: off.id,
        label: `${getFirstName(off.staff.name)} off`,
        title: `${off.staff.name} is off`,
      })),
      createLabel: (time) =>
        `New booking ${formatShortDay(day)} at ${formatTime(time)}`,
    };
  });
}

type DayColumnsInput = {
  day: string;
  today: string;
  staff: DayStaff[];
  bookings: BookingSummary[];
};

export function getDayColumns({
  day,
  today,
  staff,
  bookings,
}: DayColumnsInput): GridColumn[] {
  const dayBookings = getBookingsOn(bookings, day);
  return staff.map((person) => ({
    id: person.id,
    hasNow: day === today,
    header: (
      <span className="flex flex-col items-center gap-1">
        <Avatar name={person.name} size="sm" />
        <span className="max-w-full truncate text-[13px] font-semibold">
          {getFirstName(person.name)}
        </span>
      </span>
    ),
    blocks: dayBookings
      .filter((booking) => booking.staff.id === person.id)
      .map((booking) => toGridBlock(booking, false)),
    availability: person.freeBands,
    timeOff: person.isOff
      ? [{ id: person.id, label: "Time off", title: `${person.name} is off` }]
      : [],
    notes: person.isArchived ? <ArchivedBadge /> : undefined,
    createLabel: (time) =>
      `New booking with ${person.name}, ${formatShortDay(day)} at ${formatTime(time)}`,
  }));
}
