// Hours and weekdays on the office clock. Settings store the clean-up hour
// in UTC and the reminder hour in office time; the screen shows both in
// office time, using today's offset (daylight saving moves it).
import { formatDay } from "@/components/kit/format";
import type { SelectOption } from "@/components/kit/types/select";

const HOURS_IN_DAY = 24;
const NOON = 12;
const DAYS_IN_WEEK = 7;
const MS_PER_DAY = 86_400_000;

// ISO weekday: 1 = Monday … 7 = Sunday, as `reminder_weekday` stores it.
const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const ISO_WEEKDAY_BY_SHORT_NAME: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

export const WEEKDAY_OPTIONS: SelectOption[] = WEEKDAYS.map((day, index) => ({
  value: String(index + 1),
  label: day,
}));

export function formatHour(hour: number): string {
  const clock = hour % NOON === 0 ? NOON : hour % NOON;
  return `${clock}:00 ${hour < NOON ? "AM" : "PM"}`;
}

export const HOUR_OPTIONS: SelectOption[] = Array.from(
  { length: HOURS_IN_DAY },
  (_, hour) => ({ value: String(hour), label: formatHour(hour) }),
);

type ZoneClock = { dayKey: string; weekday: number; hour: number };

function readZoneClock(at: Date, zone: string): ZoneClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(at);
  const read = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    dayKey: `${read("year")}-${read("month")}-${read("day")}`,
    weekday: ISO_WEEKDAY_BY_SHORT_NAME[read("weekday")] ?? 1,
    hour: Number(read("hour")),
  };
}

// How many hours the zone is ahead of UTC at `at` (negative in the
// Americas), wrapped into -12…+12.
function getZoneOffsetHours(zone: string, at: Date): number {
  const offset = readZoneClock(at, zone).hour - at.getUTCHours();
  if (offset > NOON) return offset - HOURS_IN_DAY;
  if (offset < -NOON) return offset + HOURS_IN_DAY;
  return offset;
}

function wrapHour(hour: number): number {
  return (hour + HOURS_IN_DAY) % HOURS_IN_DAY;
}

export function utcToZoneHour(
  utcHour: number,
  zone: string,
  at: Date = new Date(),
): number {
  return wrapHour(utcHour + getZoneOffsetHours(zone, at));
}

export function zoneToUtcHour(
  zoneHour: number,
  zone: string,
  at: Date = new Date(),
): number {
  return wrapHour(zoneHour - getZoneOffsetHours(zone, at));
}

// "EDT" or "EST", as it is on `at`.
export function getZoneAbbreviation(zone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "short",
  }).formatToParts(at);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? zone;
}

export type NextSend = { dayKey: string; isToday: boolean; hour: number };

// The next weekly send: this week's slot if it is still ahead, else the
// same slot a week on.
export function getNextSend(
  weekday: number,
  hour: number,
  zone: string,
  now: Date = new Date(),
): NextSend {
  const today = readZoneClock(now, zone);
  let daysAhead = (weekday - today.weekday + DAYS_IN_WEEK) % DAYS_IN_WEEK;
  if (daysAhead === 0 && hour <= today.hour) daysAhead = DAYS_IN_WEEK;

  // Noon UTC keeps the date arithmetic clear of any zone's midnight.
  const day = new Date(`${today.dayKey}T12:00:00Z`);
  const dayKey = new Date(day.getTime() + daysAhead * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
  return { dayKey, isToday: daysAhead === 0, hour };
}

// "Today at 3:00 PM" or "Mon, Oct 26 at 9:00 AM".
export function formatNextSend(next: NextSend): string {
  const day = next.isToday
    ? "Today"
    : formatDay(next.dayKey, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
  return `${day} at ${formatHour(next.hour)}`;
}

// When the daily clean-up next runs, given its office-time hour.
export function getNextCleanUp(
  zoneHour: number,
  zone: string,
  now: Date = new Date(),
): "today" | "tomorrow" {
  return zoneHour > readZoneClock(now, zone).hour ? "today" : "tomorrow";
}
