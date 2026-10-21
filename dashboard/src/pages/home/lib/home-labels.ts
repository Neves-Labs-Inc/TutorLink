// Home's copy and its "today" rules. Booking times are naive business
// wall-clock strings, so "now" is read on the business clock and compared
// as a string.
import { formatClock, formatDay, pluralize } from "@/components/kit/format";
import { getBusinessNow } from "@/lib/bookings/booking-details";
import { getDaysWaiting } from "@/lib/bookings/booking-form";
import type { Role } from "@/lib/auth/auth";
import type { BookingSummary } from "@/lib/queries/bookings";
import type { ExceptionRead } from "@/lib/queries/time-off";

export type TodayTiming = "upcoming" | "now" | "past";

// Each To do card shows this many rows, then "See all".
export const ROWS_PER_CARD = 3;

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  manager: "Manager",
  tutor: "Tutor",
  developer: "Developer",
};

const SHORT_DATE: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

// "5 things in To do, 6 bookings today." Managers count sessions.
export function getHomeSummary(
  todoCount: number,
  todayCount: number,
  isManager: boolean,
): string {
  const noun = isManager ? "session" : "booking";
  const todo =
    todoCount === 0
      ? "Nothing in To do"
      : `${pluralize(todoCount, "thing", "things")} in To do`;
  const today =
    todayCount === 0
      ? `no ${noun}s today`
      : `${pluralize(todayCount, noun, `${noun}s`)} today`;
  return `${todo}, ${today}.`;
}

// "Waiting 12 days", "Waiting 1 day", or "New today".
export function getWaitingLabel(createdAt: string, now: Date): string {
  const days = getDaysWaiting(createdAt, now);
  let label = `Waiting ${pluralize(days, "day", "days")}`;
  if (days === 0) {
    label = "New today";
  }
  return label;
}

// "Thu, Oct 15, 3:30 PM"
export function formatBookingWhen(booking: BookingSummary): string {
  return `${formatDay(booking.scheduled_date, SHORT_DATE)}, ${formatClock(booking.start_time)}`;
}

// "Thu, Oct 15 – Fri, Oct 16"
export function formatTimeOffDates(item: ExceptionRead): string {
  const start = formatDay(item.start_date, SHORT_DATE);
  return item.start_date === item.end_date
    ? start
    : `${start} – ${formatDay(item.end_date, SHORT_DATE)}`;
}

// "2:00 PM – 5:00 PM" for part-day Time off; null for whole days.
export function formatTimeOffTimes(item: ExceptionRead): string | null {
  return item.start_time && item.end_time
    ? `${formatClock(item.start_time)} – ${formatClock(item.end_time)}`
    : null;
}

function getClock(date: string, time: string): string {
  return `${date}T${time.slice(0, 5)}`;
}

export function getTodayTiming(booking: BookingSummary, now: Date): TodayTiming {
  const clock = getBusinessNow(now);
  let timing: TodayTiming = "upcoming";
  if (getClock(booking.scheduled_date, booking.end_time) <= clock) {
    timing = "past";
  } else if (getClock(booking.scheduled_date, booking.start_time) <= clock) {
    timing = "now";
  }
  return timing;
}

// Cancelled ones hidden; the next one first, the ones already over last.
export function getTodayOrder(
  bookings: BookingSummary[],
  now: Date,
): BookingSummary[] {
  const byStart = bookings
    .filter((booking) => booking.status !== "cancelled")
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  return [
    ...byStart.filter((booking) => getTodayTiming(booking, now) !== "past"),
    ...byStart.filter((booking) => getTodayTiming(booking, now) === "past"),
  ];
}

// The Home's label, or the street line of its address; "In office" otherwise.
export function getLocationLabel(booking: BookingSummary): string {
  let label = "In office";
  if (booking.home) {
    label = booking.home.label ?? booking.home.address.split(",")[0];
  }
  return label;
}

export function getSubjectLabel(booking: BookingSummary): string {
  return booking.kind === "evaluation" || !booking.subject
    ? "Evaluation"
    : booking.subject.name;
}
