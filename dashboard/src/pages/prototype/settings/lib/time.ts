// Weekdays, hours and time zones as people read them.
import type { SelectOption } from "@/components/kit/components/fields";

// The prototype's "today" (kit NOW is 2026-10-13), as a fixed instant.
const TODAY = new Date("2026-10-13T12:00:00Z");
const NOON = 12;
const HOURS_IN_DAY = 24;

// ISO weekday: 1 = Monday … 7 = Sunday, as `reminder_weekday` stores it.
export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

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

// The zones an Admin may pick; a saved zone outside the list is kept.
export const TIME_ZONES: SelectOption[] = [
  { value: "America/New_York", label: "Eastern Time (New York, Miami)" },
  { value: "America/Chicago", label: "Central Time (Chicago)" },
  { value: "America/Denver", label: "Mountain Time (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

export function getTimeZoneLabel(zone: string): string {
  return TIME_ZONES.find((option) => option.value === zone)?.label ?? zone;
}

// How many hours the business zone is ahead of UTC today (negative in
// the Americas). Daylight saving moves this by an hour twice a year.
function getZoneOffsetHours(zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(TODAY);
  const zoneHour = Number(parts.find((part) => part.type === "hour")?.value);
  const offset = zoneHour - TODAY.getUTCHours();
  // Wrap into -12…+12 when the two clocks straddle midnight.
  if (offset > NOON) return offset - HOURS_IN_DAY;
  if (offset < -NOON) return offset + HOURS_IN_DAY;
  return offset;
}

function wrapHour(hour: number): number {
  return (hour + HOURS_IN_DAY) % HOURS_IN_DAY;
}

export function utcToZoneHour(utcHour: number, zone: string): number {
  return wrapHour(utcHour + getZoneOffsetHours(zone));
}

export function zoneToUtcHour(zoneHour: number, zone: string): number {
  return wrapHour(zoneHour - getZoneOffsetHours(zone));
}

export function getShortZoneName(zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "short",
  }).formatToParts(TODAY);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? zone;
}
