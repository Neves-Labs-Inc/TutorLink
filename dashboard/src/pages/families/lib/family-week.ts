// What the family week shows, worked out from the wire: the range and
// day labels, each Booking's block, and the link to Bookings.
import type { BookingBlockDisplay } from "@/components/kit/components/booking-block";
import { formatDay } from "@/components/kit/format";
import type { ChildTone } from "@/components/kit/lib/child-tones";
import { getFirstName, getWhat } from "@/lib/bookings/calendar";
import { formatTime } from "@/lib/dates/dates";
import type { BookingSummary } from "@/lib/queries/bookings";
import { addDays } from "@/lib/week";

const LAST_DAY_OFFSET = 6;
// Bookings' Child filter, repeated once per Child (`/bookings?child=…`).
const BOOKINGS_CHILD_PARAM = "child";

export function getWeekEnd(weekStart: string): string {
  return addDays(weekStart, LAST_DAY_OFFSET);
}

// "Oct 12 – 18", "Sep 28 – Oct 4", "Dec 28, 2026 – Jan 3, 2027".
export function formatWeekRange(weekStart: string): string {
  const weekEnd = getWeekEnd(weekStart);
  const isSameYear = weekStart.slice(0, 4) === weekEnd.slice(0, 4);
  const isSameMonth = isSameYear && weekStart.slice(0, 7) === weekEnd.slice(0, 7);

  let range: string;
  if (isSameMonth) {
    range = `${formatDay(weekStart, { month: "short", day: "numeric" })} – ${formatDay(weekEnd, { day: "numeric" })}`;
  } else if (isSameYear) {
    range = `${formatDay(weekStart, { month: "short", day: "numeric" })} – ${formatDay(weekEnd, { month: "short", day: "numeric" })}`;
  } else {
    const withYear: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
    range = `${formatDay(weekStart, withYear)} – ${formatDay(weekEnd, withYear)}`;
  }
  return range;
}

// The grid's column header: "Mon 12".
export function formatGridDay(day: string): string {
  return `${formatDay(day, { weekday: "short" })} ${formatDay(day, { day: "numeric" })}`;
}

// The list's day label: "Mon Oct 12".
export function formatListDay(day: string): string {
  return `${formatDay(day, { weekday: "short" })} ${formatDay(day, { month: "short", day: "numeric" })}`;
}

export function getBookingsUrl(childIds: string[]): string {
  const search = new URLSearchParams(
    childIds.map((id) => [BOOKINGS_CHILD_PARAM, id]),
  );
  return `/bookings?${search}`;
}

export function toWeekBlock(
  booking: BookingSummary,
  tone: ChildTone,
): BookingBlockDisplay {
  return {
    time: formatTime(booking.start_time),
    name: getFirstName(booking.child.name),
    fullName: booking.child.name,
    what: getWhat(booking),
    isEvaluation: booking.kind === "evaluation",
    staffName: booking.staff.name,
    status: booking.status,
    tone,
  };
}
