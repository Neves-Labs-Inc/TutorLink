// How Child details word a Child's wire fields, and the copy its
// Archive and Guardian acts build from counts and names.
import { formatClock, formatDay, getTodayKey, pluralize } from "@/components/kit/format";
import { gradeName } from "@/lib/grades/grades";
import type { NextSession } from "@/types/families";

const MONTHS_PER_YEAR = 12;

// Whole years between two "YYYY-MM-DD" days.
function getAgeInYears(dateOfBirth: string, today: string): number {
  const [birthYear, birthMonth, birthDay] = dateOfBirth.split("-").map(Number);
  const [year, month, day] = today.split("-").map(Number);
  const monthsBetween =
    (year - birthYear) * MONTHS_PER_YEAR + (month - birthMonth);
  const hasHadBirthday = day >= birthDay;
  const months = hasHadBirthday ? monthsBetween : monthsBetween - 1;
  return Math.floor(months / MONTHS_PER_YEAR);
}

// "Mar 4, 2016 · 10 years old"; null when it isn't recorded.
export function formatDateOfBirth(
  dateOfBirth: string | null,
  today: string = getTodayKey(),
): string | null {
  if (dateOfBirth === null) return null;

  const day = formatDay(dateOfBirth, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const age = getAgeInYears(dateOfBirth, today);
  return `${day} · ${pluralize(age, "year old", "years old")}`;
}

export function formatOverallGrade(gradeLevel: number | null): string {
  return gradeLevel === null ? "Grade not set" : gradeName(gradeLevel);
}

// "Thu, Oct 15, 3:30 PM · Ana".
export function formatNextSession(session: NextSession): string {
  const day = formatDay(session.scheduled_date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day}, ${formatClock(session.start_time)} · ${session.tutor.name}`;
}

export function formatUpcomingCount(count: number): string {
  return pluralize(count, "upcoming Booking", "upcoming Bookings");
}

export function getFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

// The Archive confirm's body.
export function describeChildArchive(cancellations: number): string {
  if (cancellations === 0) return "They can’t be booked until restored.";

  return cancellations === 1
    ? "Their 1 upcoming Booking is cancelled, and Restore won’t bring it back."
    : `Their ${cancellations} upcoming Bookings are cancelled, and Restore won’t bring them back.`;
}

// The toast after an archive, from what the API says it cancelled.
export function describeChildArchived(name: string, cancelled: number): string {
  if (cancelled === 0) return `${name} archived.`;

  const bookings =
    cancelled === 1
      ? "1 upcoming Booking was cancelled"
      : `${cancelled} upcoming Bookings were cancelled`;
  return `${name} archived. ${bookings}.`;
}
