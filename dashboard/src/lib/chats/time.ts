// Chat date copy in US format (DESIGN §15.2). Business time is fixed
// (Doral, FL), so every formatter pins the zone instead of trusting the
// viewer's machine. "Now" is passed in, so callers tick it with `useNow`.
import { BUSINESS_TIME_ZONE as ZONE } from "@/components/kit/format";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOON_UTC = "T12:00:00Z";
const MAX_DAYS_SHOWN_AS_WEEKDAY = 6;

function getZonedDayKey(at: string | number): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Date(at).toLocaleDateString("en-CA", { timeZone: ZONE });
}

function getYear(at: string | number): string {
  return getZonedDayKey(at).slice(0, 4);
}

function getDaysAgo(iso: string, nowMs: number): number {
  const today = Date.parse(`${getZonedDayKey(nowMs)}${NOON_UTC}`);
  const day = Date.parse(`${getZonedDayKey(iso)}${NOON_UTC}`);
  return Math.round((today - day) / MS_PER_DAY);
}

function formatDate(
  iso: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(iso).toLocaleDateString("en-US", {
    ...options,
    timeZone: ZONE,
  });
}

export function isSameDay(a: string, b: string): boolean {
  return getZonedDayKey(a) === getZonedDayKey(b);
}

// "5:00 PM"
export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ZONE,
  });
}

// List timestamps: "8:31 AM", "Yesterday", "Sun", "Oct 4", "Oct 4, 2025".
export function formatListTime(iso: string, nowMs: number): string {
  const daysAgo = getDaysAgo(iso, nowMs);
  if (daysAgo <= 0) return formatClockTime(iso);
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= MAX_DAYS_SHOWN_AS_WEEKDAY) {
    return formatDate(iso, { weekday: "short" });
  }
  const isOtherYear = getYear(iso) !== getYear(nowMs);
  return formatDate(iso, {
    month: "short",
    day: "numeric",
    ...(isOtherYear && { year: "numeric" }),
  });
}

// Thread day separators: "Today", "Yesterday", "Sunday, Oct 11".
export function formatDayHeading(iso: string, nowMs: number): string {
  const daysAgo = getDaysAgo(iso, nowMs);
  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  const isOtherYear = getYear(iso) !== getYear(nowMs);
  return formatDate(iso, {
    weekday: "long",
    month: "short",
    day: "numeric",
    ...(isOtherYear && { year: "numeric" }),
  });
}

// "Sun, Oct 18, 5:00 PM"
export function formatDayAndTime(iso: string): string {
  const day = formatDate(iso, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day}, ${formatClockTime(iso)}`;
}

// "Week of Oct 19" from a Monday "YYYY-MM-DD".
export function formatWeekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}${NOON_UTC}`).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric", timeZone: "UTC" },
  );
  return `Week of ${date}`;
}
