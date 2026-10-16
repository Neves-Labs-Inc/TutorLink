// Wire values → UI copy (CONTEXT.md vocabulary), and the date and time
// maths the views need. Business time is fixed (Doral, FL), so plain
// local Date maths on "YYYY-MM-DD" keys is enough.
import type {
  BookingKind,
  BookingStatus,
  BookingSummary,
  HomeSummaryRef,
  SortOutReason,
} from "@/pages/prototype/bookings/lib/wire";
import { TODAY } from "@/pages/prototype/bookings/lib/mock-data";

const MINUTES_PER_HOUR = 60;
const DAYS_PER_WEEK = 7;
const KINDERGARTEN = 0;

export const KIND_LABEL: Record<BookingKind, "Tutoring" | "Evaluation"> = {
  regular: "Tutoring",
  evaluation: "Evaluation",
};

export const STATUS_LABEL: Record<
  BookingStatus,
  "Pending" | "Confirmed" | "Completed" | "Cancelled"
> = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Short, scannable reason chips; the long form lives in the detail.
export const REASON_LABEL: Record<SortOutReason, string> = {
  not_completed: "Not marked",
  time_off_clash: "Staff is off",
  archived_staff: "Staff archived",
};

export function formatGrade(level: number | null): string {
  if (level === null) return "No level yet";
  return level === KINDERGARTEN ? "Kindergarten" : `Grade ${level}`;
}

export function getSubjectLine(booking: BookingSummary): string {
  if (booking.kind === "evaluation" || !booking.subject) return "Evaluation";
  return `${booking.subject.name} · ${formatGrade(booking.subject_level)}`;
}

function toDate(dayKey: string): Date {
  return new Date(`${dayKey}T12:00:00`);
}

export function toDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(dayKey: string, days: number): string {
  const date = toDate(dayKey);
  date.setDate(date.getDate() + days);
  return toDayKey(date);
}

export function getWeekday(dayKey: string): number {
  return toDate(dayKey).getDay();
}

// Weeks start on Monday.
export function getWeekStart(dayKey: string): string {
  const offset = (getWeekday(dayKey) + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK;
  return addDays(dayKey, -offset);
}

export function getWeekDays(weekStart: string): string[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
    addDays(weekStart, index),
  );
}

export function formatDay(
  dayKey: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return toDate(dayKey).toLocaleDateString("en-US", options);
}

export function formatShortDay(dayKey: string): string {
  return formatDay(dayKey, { weekday: "short", month: "short", day: "numeric" });
}

export function formatLongDay(dayKey: string): string {
  return formatDay(dayKey, { weekday: "long", month: "long", day: "numeric" });
}

export function getRelativeDay(dayKey: string): string {
  let label = formatDay(dayKey, { weekday: "long" });
  if (dayKey === TODAY) {
    label = "Today";
  } else if (dayKey === addDays(TODAY, 1)) {
    label = "Tomorrow";
  } else if (dayKey === addDays(TODAY, -1)) {
    label = "Yesterday";
  }
  return label;
}

export function formatWeekRange(weekStart: string): string {
  const end = addDays(weekStart, DAYS_PER_WEEK - 1);
  const startLabel = formatDay(weekStart, { month: "short", day: "numeric" });
  const isSameMonth = weekStart.slice(5, 7) === end.slice(5, 7);
  const endLabel = formatDay(end, isSameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

// "15:30:00" → minutes since midnight.
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

export function fromMinutes(total: number): string {
  const hours = String(Math.floor(total / MINUTES_PER_HOUR)).padStart(2, "0");
  const minutes = String(total % MINUTES_PER_HOUR).padStart(2, "0");
  return `${hours}:${minutes}:00`;
}

// "15:30:00" → "3:30 PM".
export function formatTime(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function getDurationMinutes(start: string, end: string): number {
  return toMinutes(end) - toMinutes(start);
}

export function formatDateTime(iso: string): string {
  const [day, time] = iso.split("T");
  return `${formatDay(day, { month: "short", day: "numeric" })}, ${formatTime(time)}`;
}

export function getFirstName(name: string): string {
  return name.split(" ")[0];
}

export function formatHome(home: HomeSummaryRef | null): string {
  if (!home) return "In office";
  return home.label ? `${home.label} · ${home.address}` : home.address;
}

export function getDaysSince(iso: string): number {
  const created = toDate(iso.slice(0, 10)).getTime();
  const MS_PER_DAY = 86_400_000;
  return Math.round((toDate(TODAY).getTime() - created) / MS_PER_DAY);
}

export function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
