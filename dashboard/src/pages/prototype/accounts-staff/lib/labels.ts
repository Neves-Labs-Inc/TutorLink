// Wire values to the words on screen (CONTEXT.md vocabulary).
import type {
  RemindersState,
  SignInState,
  SlotLocation,
  StaffRole,
  TimeOffStatus,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import { formatClock } from "@/pages/prototype/shell-kit/kit/format";
import type {
  AvailabilityMode,
  BookingSummary,
  ExceptionRead,
  ExceptionReadStatus,
  Language,
  RemindersWire,
  SignInStateWire,
  UserRole,
} from "@/pages/prototype/accounts-staff/types/api";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export function formatGrade(grade: number | null): string {
  if (grade === null) return "Not set";
  return grade === 0 ? "Kindergarten" : `Grade ${grade}`;
}

const HIGHEST_GRADE = 12;

export const GRADE_OPTIONS = Array.from({ length: HIGHEST_GRADE + 1 }, (_, grade) => ({
  value: String(grade),
  label: formatGrade(grade),
}));

const MAX_TITLE_SURNAMES = 2;

function getSurname(name: string): string {
  return name.trim().split(/\s+/).slice(-1)[0] ?? name;
}

// A family has no name on the wire. Placeholder from the Guardians'
// surnames: "Gomez family", "Martinez & Reyes family", and past two
// surnames the first Guardian's name plus a count.
export function getFamilyTitle(
  guardians: { name: string }[],
  children: { name: string }[] = [],
): string {
  const surnames = [...new Set(guardians.map((guardian) => getSurname(guardian.name)))];
  // A family with no Guardian yet goes by its Child's surname.
  if (surnames.length === 0) {
    return children[0] ? `${getSurname(children[0].name)} family` : "Family";
  }
  return surnames.length <= MAX_TITLE_SURNAMES
    ? `${surnames.join(" & ")} family`
    : `${guardians[0].name} +${guardians.length - 1}`;
}

export function getLanguageLabel(language: Language | null): string {
  return language === "es" ? "Spanish" : "English";
}

const REMINDERS: Record<RemindersWire, RemindersState> = {
  opt_in: "Reminders on",
  opt_out: "Reminders off",
  never: "Never asked",
};

export function getRemindersLabel(reminders: RemindersWire): RemindersState {
  return REMINDERS[reminders];
}

const SIGN_IN: Record<SignInStateWire, SignInState> = {
  not_invited: "Not invited",
  invited: "Invited",
  active: "Active",
};

export function getSignInLabel(state: SignInStateWire): SignInState {
  return SIGN_IN[state];
}

const ROLES: Record<UserRole, StaffRole | "Developer"> = {
  admin: "Admin",
  manager: "Manager",
  tutor: "Tutor",
  developer: "Developer",
};

export function getRoleLabel(role: UserRole): string {
  return ROLES[role];
}

const MODES: Record<AvailabilityMode, SlotLocation> = {
  traveler: "Home visits",
  anywhere: "Home or office",
  only_office: "Office only",
};

export function getModeLabel(mode: AvailabilityMode): SlotLocation {
  return MODES[mode];
}

export function getModeFromLabel(label: SlotLocation): AvailabilityMode {
  const entry = Object.entries(MODES).find(([, value]) => value === label);
  // Every SlotLocation is one of MODES' values.
  return (entry?.[0] ?? "anywhere") as AvailabilityMode;
}

const TIME_OFF: Record<ExceptionReadStatus, TimeOffStatus | "Expired"> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};

export function getTimeOffLabel(
  status: ExceptionReadStatus,
): TimeOffStatus | "Expired" {
  return TIME_OFF[status];
}

function parseDate(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return { year, month, day };
}

export function formatShortDate(iso: string): string {
  const { month, day } = parseDate(iso);
  return `${MONTHS[month - 1]} ${day}`;
}

export function formatWeekdayDate(iso: string): string {
  const { year, month, day } = parseDate(iso);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${weekday}, ${MONTHS[month - 1]} ${day}`;
}

export function formatLongDate(iso: string): string {
  const { year, month, day } = parseDate(iso);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

// "15:00:00" → "3:00 PM"
export function formatWireTime(time: string): string {
  return formatClock(time.slice(0, 5));
}

export function formatTimeOffWindow(item: ExceptionRead): string {
  const days =
    item.start_date === item.end_date
      ? formatWeekdayDate(item.start_date)
      : `${formatShortDate(item.start_date)} – ${formatShortDate(item.end_date)}`;
  const hours =
    item.start_time && item.end_time
      ? `, ${formatWireTime(item.start_time)} – ${formatWireTime(item.end_time)}`
      : "";
  return `${days}${hours}`;
}

export function formatBookingWhen(booking: BookingSummary): string {
  return `${formatWeekdayDate(booking.scheduled_date)}, ${formatWireTime(booking.start_time)}`;
}

export function formatBookingWhat(booking: BookingSummary): string {
  const kind = booking.kind === "evaluation" ? "Evaluation" : booking.subject?.name;
  const where = booking.location === "in_office" ? "In office" : (booking.home?.label ?? "Home");
  return `${booking.child.name} · ${kind ?? "Tutoring"} · ${where}`;
}

// "+13055550142" → "+1 305 555 0142"
export function formatPhone(phone: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return match ? `+1 ${match[1]} ${match[2]} ${match[3]}` : phone;
}

export function formatAge(dateOfBirth: string | null, today: string): string {
  if (!dateOfBirth) return "Not recorded";
  const birth = parseDate(dateOfBirth);
  const now = parseDate(today);
  const hasHadBirthday =
    now.month > birth.month || (now.month === birth.month && now.day >= birth.day);
  const age = now.year - birth.year - (hasHadBirthday ? 0 : 1);
  return `${formatLongDate(dateOfBirth)} · ${age} years old`;
}
