// Calendar-week arithmetic on "YYYY-MM-DD" day keys (business dates,
// no time zone math needed). Weeks run Monday to Sunday.
const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_IN_WEEK = 7;
const SUNDAY = 0;

function toUtc(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

export function addDays(day: string, count: number): string {
  return new Date(toUtc(day).getTime() + count * DAY_MS).toISOString().slice(0, 10);
}

export function getWeekStart(day: string): string {
  const weekday = toUtc(day).getUTCDay();
  // Sunday belongs to the week that started six days before.
  return addDays(day, weekday === SUNDAY ? -6 : 1 - weekday);
}

export function getWeekDays(weekStart: string): string[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) => addDays(weekStart, index));
}

export function getWeekEnd(weekStart: string): string {
  return addDays(weekStart, DAYS_IN_WEEK - 1);
}

export function shiftWeek(weekStart: string, weeks: number): string {
  return addDays(weekStart, weeks * DAYS_IN_WEEK);
}
