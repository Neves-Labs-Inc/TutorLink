// Wire values to UI copy, in CONTEXT.md's words.
import { formatDay, pluralize } from "@/pages/prototype/shell-kit/kit/format";
import { TODAY } from "@/pages/prototype/shell-kit/kit/mock-data";
import type {
  BookingSummary,
  ExceptionRead,
  ExceptionReadStatus,
  UserRole,
} from "@/pages/prototype/tutor-timeoff/types/api";

const MS_PER_DAY = 86_400_000;

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  tutor: "Tutor",
  developer: "Developer",
};

export const TIME_OFF_STATUS_LABEL: Record<ExceptionReadStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

// "15:00:00" → "3:00 PM"; ":00" minutes dropped on request.
export function formatClock(hhmmss: string, isShort = false): string {
  const [hours, minutes] = hhmmss.split(":").map(Number);
  const text = new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  return isShort ? text.replace(":00", "") : text;
}

export function formatDate(dayKey: string): string {
  return formatDay(dayKey, { weekday: "short", month: "short", day: "numeric" });
}

export function formatLongDate(dayKey: string): string {
  return formatDay(dayKey, { weekday: "long", month: "long", day: "numeric" });
}

function getYear(dayKey: string): string {
  return dayKey.slice(0, 4);
}

function formatShortDate(dayKey: string, hasYear: boolean): string {
  return formatDay(dayKey, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: hasYear ? "numeric" : undefined,
  });
}

type Window = Pick<ExceptionRead, "start_date" | "end_date" | "start_time" | "end_time">;

// "Tue, Oct 20 – Thu, Oct 22", "Sat, Oct 24 · 1 – 5 PM".
export function formatTimeOffDates(window: Window): string {
  const hasYear =
    getYear(window.start_date) !== getYear(TODAY) ||
    getYear(window.end_date) !== getYear(TODAY);
  const first = formatShortDate(window.start_date, hasYear);
  const dates =
    window.start_date === window.end_date
      ? first
      : `${first} – ${formatShortDate(window.end_date, hasYear)}`;
  const hours =
    window.start_time && window.end_time
      ? ` · ${formatClock(window.start_time, true)} – ${formatClock(window.end_time, true)}`
      : "";
  return `${dates}${hours}`;
}

export function getDayCount(window: Window): number {
  const start = new Date(`${window.start_date}T12:00:00`).getTime();
  const end = new Date(`${window.end_date}T12:00:00`).getTime();
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

export function formatLength(window: Window): string {
  return window.start_time ? "Part of the day" : pluralize(getDayCount(window), "day", "days");
}

// When it was asked, decided or cancelled: "Oct 12, 9:15 AM".
export function formatStamp(at: string): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export function formatLevel(level: number): string {
  return level === 0 ? "Kindergarten" : `Grade ${level}`;
}

export function getSubjectLine(session: BookingSummary): string {
  if (session.kind === "evaluation") return "Evaluation session";
  const name = session.subject?.name ?? "No subject";
  return session.subject_level === null
    ? name
    : `${name} · ${formatLevel(session.subject_level)}`;
}

export function getPlaceLine(session: BookingSummary): string {
  if (session.location === "in_office" || session.home === null) return "In office";
  return session.home.label
    ? `${session.home.label} · ${session.home.address}`
    : session.home.address;
}

export function getFirstName(name: string): string {
  return name.split(" ")[0];
}

export function formatPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "").slice(-10);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function getMapsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}
