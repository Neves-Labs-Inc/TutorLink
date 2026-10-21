// The Tutor's Session rules, on the business clock. Session times are
// naive business wall-clock strings, so "now" is read in the business's
// time zone and compared as a wall-clock string too.
import { BUSINESS_TIME_ZONE, formatClock, formatDay } from "@/components/kit/format";
import type { BookingSummary } from "@/lib/queries/bookings";

export type SessionTiming = Pick<
  BookingSummary,
  "scheduled_date" | "start_time" | "end_time" | "status"
>;

export type SessionDayGroup<T> = { dayKey: string; sessions: T[] };

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const MINUTES_PER_HOUR = 60;
const DAYS_NAMED_BY_WEEKDAY = 6;

const BUSINESS_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

// "2026-10-20T15:05:00": the business's wall clock at `at`.
export function getBusinessClock(at: Date): string {
  const parts = Object.fromEntries(
    BUSINESS_CLOCK.formatToParts(at).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// "2026-10-19" for the business day before `dayKey`.
export function getPreviousDayKey(dayKey: string): string {
  const date = new Date(`${dayKey}T00:00:00Z`);
  return new Date(date.getTime() - MS_PER_DAY).toISOString().slice(0, 10);
}

function getStart(session: SessionTiming): string {
  return `${session.scheduled_date}T${session.start_time}`;
}

function getEnd(session: SessionTiming): string {
  return `${session.scheduled_date}T${session.end_time}`;
}

// Wall-clock maths: both sides read as if UTC, so the zone cancels out.
function getWallClockMs(clock: string): number {
  return new Date(`${clock}Z`).getTime();
}

export function hasStarted(session: SessionTiming, now: Date): boolean {
  return getStart(session) <= getBusinessClock(now);
}

export function hasEnded(session: SessionTiming, now: Date): boolean {
  return getEnd(session) <= getBusinessClock(now);
}

function isLive(session: SessionTiming): boolean {
  return session.status === "pending" || session.status === "confirmed";
}

// Still Pending or Confirmed after its end: the office must mark it.
export function isNotMarked(session: SessionTiming, now: Date): boolean {
  return isLive(session) && hasEnded(session, now);
}

// The API lets a Tutor make one move: Confirmed to Completed, once started.
export function canMarkCompleted(session: SessionTiming, now: Date): boolean {
  return session.status === "confirmed" && hasStarted(session, now);
}

// The first session in a soonest-first list that the Tutor still has to go to.
export function findNextUp<T extends SessionTiming>(sessions: T[], now: Date): T | null {
  return (
    sessions.find(
      (session) => session.status !== "cancelled" && !hasEnded(session, now),
    ) ?? null
  );
}

// Day groups in the order the list already has.
export function groupByDay<T extends SessionTiming>(sessions: T[]): SessionDayGroup<T>[] {
  const dayKeys = [...new Set(sessions.map((session) => session.scheduled_date))];
  return dayKeys.map((dayKey) => ({
    dayKey,
    sessions: sessions.filter((session) => session.scheduled_date === dayKey),
  }));
}

function getDaysBetween(fromKey: string, toKey: string): number {
  return Math.round(
    (getWallClockMs(`${toKey}T00:00:00`) - getWallClockMs(`${fromKey}T00:00:00`)) / MS_PER_DAY,
  );
}

function getDayName(dayKey: string, todayKey: string): string {
  const days = getDaysBetween(todayKey, dayKey);
  let name = formatDay(dayKey, { weekday: "short", month: "short", day: "numeric" });
  if (days === 0) {
    name = "Today";
  } else if (days === 1) {
    name = "Tomorrow";
  } else if (days > 1 && days <= DAYS_NAMED_BY_WEEKDAY) {
    name = formatDay(dayKey, { weekday: "long" });
  }
  return name;
}

// "Happening now", "In 25 min", "Today at 3:30 PM", "Tomorrow at …", "Monday at …".
export function getStartsIn(session: SessionTiming, now: Date): string {
  const clock = getBusinessClock(now);
  const minutes = Math.ceil(
    (getWallClockMs(getStart(session)) - getWallClockMs(clock)) / MS_PER_MINUTE,
  );
  let text = `${getDayName(session.scheduled_date, clock.slice(0, 10))} at ${formatClock(session.start_time)}`;
  if (minutes <= 0) {
    text = "Happening now";
  } else if (minutes < MINUTES_PER_HOUR) {
    text = `In ${minutes} min`;
  }
  return text;
}
