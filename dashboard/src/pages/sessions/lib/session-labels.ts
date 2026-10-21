// A Session's wire values as the Tutor reads them, in CONTEXT.md's words.
import { formatClock } from "@/components/kit/format";
import { gradeName } from "@/lib/grades/grades";
import type { BookingSummary } from "@/lib/queries/bookings";
import { hasEnded, hasStarted } from "@/pages/sessions/lib/session-rules";

type SessionLine = Pick<
  BookingSummary,
  "kind" | "subject" | "subject_level" | "location" | "home" | "office_address"
>;

const MINUTES_PER_HOUR = 60;
const NO_LEVEL = "No level yet";

export function getFirstName(name: string): string {
  return name.split(" ")[0];
}

export function getLevelName(level: number | null): string {
  return level === null ? NO_LEVEL : gradeName(level);
}

// "Maths · Grade 5", "Maths · No level yet", or "Evaluation session".
export function getSubjectLine(session: SessionLine): string {
  if (session.kind === "evaluation" || !session.subject) return "Evaluation session";

  return `${session.subject.name} · ${getLevelName(session.subject_level)}`;
}

export function isInOffice(session: SessionLine): boolean {
  return session.location === "in_office" || session.home === null;
}

// "Garcia home · 12 Oak St", "In office · 1 Main St", or "In office".
export function getPlaceLine(session: SessionLine): string {
  const parts = isInOffice(session)
    ? ["In office", session.office_address]
    : [session.home?.label && `${session.home.label} home`, session.home?.address];
  return parts.filter(Boolean).join(" · ");
}

// "4:30" from "16:30:00": the end under a time chip, which already says AM/PM.
function formatBareClock(time: string): string {
  return formatClock(time).split(" ")[0];
}

export function getTimeCaption(
  session: Pick<BookingSummary, "scheduled_date" | "start_time" | "end_time" | "status">,
  now: Date,
): string {
  const isRunning = hasStarted(session, now) && !hasEnded(session, now);
  return isRunning ? "Now" : `to ${formatBareClock(session.end_time)}`;
}

export function getTimeRange(session: Pick<BookingSummary, "start_time" | "end_time">): string {
  return `${formatClock(session.start_time)} – ${formatClock(session.end_time)}`;
}

function getMinuteOfDay(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

export function getDurationMinutes(session: Pick<BookingSummary, "start_time" | "end_time">): number {
  return getMinuteOfDay(session.end_time) - getMinuteOfDay(session.start_time);
}

export function getMapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
