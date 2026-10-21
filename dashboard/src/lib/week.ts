// Calendar-week arithmetic on "YYYY-MM-DD" business-day keys. Business dates
// carry no time zone, so plain UTC date maths is exact. Weeks run Monday to
// Sunday.
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_IN_WEEK = 7;
const SUNDAY = 0;

function toUtc(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

export function addDays(day: string, count: number): string {
  return new Date(toUtc(day).getTime() + count * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export function getWeekStart(day: string): string {
  const weekday = toUtc(day).getUTCDay();
  // Sunday belongs to the week that started six days before.
  return addDays(day, weekday === SUNDAY ? -6 : 1 - weekday);
}

export function addWeeks(weekStart: string, count: number): string {
  return addDays(weekStart, count * DAYS_IN_WEEK);
}
