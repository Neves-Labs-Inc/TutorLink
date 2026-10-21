// Labels for the Bookings page: the week range and the list rows.
import { formatDay } from "@/components/kit/format";
import type { BookingSummary } from "@/lib/queries/bookings";
import type { ChildSummary } from "@/lib/queries/children";
import { addDays } from "@/lib/week";

const MINUTES_PER_HOUR = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const KINDERGARTEN = 0;
const LAST_DAY_OFFSET = 6;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

// "60 min"
export function formatLength(booking: BookingSummary): string {
  return `${toMinutes(booking.end_time) - toMinutes(booking.start_time)} min`;
}

// The Subject, or "Evaluation" when there is none.
export function getSubjectLabel(booking: BookingSummary): string {
  return booking.subject?.name ?? "Evaluation";
}

// The Home's label ("Main home"), "Home" when it has none, or "In office".
export function getLocationLabel(booking: BookingSummary): string {
  let label = "In office";
  if (booking.location === "home") {
    label = booking.home?.label ?? "Home";
  }
  return label;
}

// "Thu, Oct 15"
export function formatShortDate(day: string): string {
  return formatDay(day, { weekday: "short", month: "short", day: "numeric" });
}

// "Science Grade 3 · Reading Kindergarten"
export function formatLevels(child: ChildSummary): string {
  return (child.levels ?? [])
    .map(
      (level) =>
        `${level.name} ${level.level === KINDERGARTEN ? "Kindergarten" : `Grade ${level.level}`}`,
    )
    .join(" · ");
}

// How long a Child has waited for an Evaluation: "Waiting 12 days".
export function formatWaiting(child: ChildSummary, now: Date): string {
  const days = Math.floor(
    (now.getTime() - new Date(child.created_at).getTime()) / MS_PER_DAY,
  );
  let label = `Waiting ${days} days`;
  if (days < 1) {
    label = "New today";
  } else if (days === 1) {
    label = "Waiting 1 day";
  }
  return label;
}

// "Oct 12 – 18", or "Oct 26 – Nov 1" across a month.
export function formatWeekRange(weekStart: string, joiner = " – "): string {
  const weekEnd = addDays(weekStart, LAST_DAY_OFFSET);
  const isSameMonth = weekStart.slice(0, 7) === weekEnd.slice(0, 7);
  const start = formatDay(weekStart, { month: "short", day: "numeric" });
  const end = formatDay(
    weekEnd,
    isSameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  );
  return `${start}${joiner}${end}`;
}
