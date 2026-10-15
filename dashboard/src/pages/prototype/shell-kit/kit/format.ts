// Date and name formatting for the sample pages. Business time is fixed
// (Doral, FL), and the data is naive business-local strings, so most
// helpers use plain local Date maths. Only getGreeting and
// formatUpdatedAt cross zones, so they pin BUSINESS_TIME_ZONE.
import { NOW, TODAY } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Booking } from "@/pages/prototype/shell-kit/kit/mock-data";

// The business's clock; fixed, it never changes.
export const BUSINESS_TIME_ZONE = "America/New_York";

const NOON = 12;
const EVENING = 17;
const MS_PER_MINUTE = 60_000;

export function getDayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function formatDay(
  dayKey: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(`${dayKey}T12:00:00`).toLocaleDateString("en-US", options);
}

export function formatTime(at: string | Date): string {
  return new Date(at).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatTimeRange(booking: Booking): string {
  const end = new Date(
    new Date(booking.start).getTime() + booking.durationMin * MS_PER_MINUTE,
  );
  return `${formatTime(booking.start)} – ${formatTime(end)}`;
}

export function getRelativeDayLabel(dayKey: string): string {
  const tomorrow = new Date(`${TODAY}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  let label = formatDay(dayKey, { weekday: "long" });
  if (dayKey === TODAY) {
    label = "Today";
  } else if (dayKey === formatDayKey(tomorrow)) {
    label = "Tomorrow";
  }
  return label;
}

function formatDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

function getBusinessHour(at: string | Date): number {
  // A naive ISO string is already business wall-clock time.
  if (typeof at === "string" && !HAS_OFFSET.test(at)) {
    return Number(at.slice(11, 13));
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    timeZone: BUSINESS_TIME_ZONE,
  }).formatToParts(new Date(at));
  return Number(parts.find((part) => part.type === "hour")?.value);
}

export function getGreeting(at: string | Date = NOW): string {
  const hour = getBusinessHour(at);
  let greeting = "Good evening";
  if (hour < NOON) {
    greeting = "Good morning";
  } else if (hour < EVENING) {
    greeting = "Good afternoon";
  }
  return greeting;
}

// "9:41 AM" on the business's clock, whatever the viewer's time zone.
export function formatUpdatedAt(at: Date): string {
  return at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

export type DayGroup<T> = { dayKey: string; items: T[] };

export function groupByDay(list: Booking[]): DayGroup<Booking>[] {
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  const keys = [...new Set(sorted.map((booking) => getDayKey(booking.start)))];
  return keys.map((dayKey) => ({
    dayKey,
    items: sorted.filter((booking) => getDayKey(booking.start) === dayKey),
  }));
}

export function pluralize(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// "15:00" → "3:00 PM" (availability times are stored 24h).
export function formatClock(hhmm: string): string {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
