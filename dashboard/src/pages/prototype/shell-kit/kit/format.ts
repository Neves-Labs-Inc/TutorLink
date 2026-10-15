// Date and name formatting for the sample pages. Business time is fixed
// (Doral, FL), so local Date maths is enough here.
import { TODAY } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Booking } from "@/pages/prototype/shell-kit/kit/mock-data";

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

export function getGreeting(iso: string): string {
  const hour = new Date(iso).getHours();
  let greeting = "Good evening";
  if (hour < NOON) {
    greeting = "Good morning";
  } else if (hour < EVENING) {
    greeting = "Good afternoon";
  }
  return greeting;
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
