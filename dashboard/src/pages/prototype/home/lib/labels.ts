// Wire values → the words in CONTEXT.md, and the date/time copy Home
// shows. Business time is fixed (Doral), so plain Date maths is enough.
import type { AttentionReason } from "@/pages/prototype/shared/mock-data";
import { NOW, TODAY } from "@/pages/prototype/home/lib/mock-api";
import type {
  BookingSummary,
  ChildSummary,
  ConversationSummary,
  ExceptionRead,
  FlagReason,
  SortOutReason,
  UserRole,
} from "@/pages/prototype/home/types/api";

const MS_PER_DAY = 86_400_000;

// The wire still says "to sort out"; the UI never does.
export const SORT_OUT_LABEL: Record<SortOutReason, string> = {
  not_completed: "Not marked",
  time_off_clash: "Staff is off",
  archived_staff: "Staff archived",
};

// One row of To do › Bookings: a Booking needing a decision, or a Child
// whose Evaluation isn't booked yet.
export type BookingTodo =
  | { kind: "booking"; id: string; booking: BookingSummary }
  | { kind: "needs-tutor"; id: string; child: ChildSummary }
  | { kind: "evaluation"; id: string; child: ChildSummary };

// The rows the To do details slide-over handles; a Needs a Tutor row
// opens Child details instead.
export type DeskTodo = Exclude<BookingTodo, { kind: "needs-tutor" }>;

const REASON_RANK: Record<SortOutReason, number> = {
  time_off_clash: 0,
  archived_staff: 0,
  not_completed: 1,
};

function getBookingRank(booking: BookingSummary): number {
  const reason = booking.sort_out_reasons[0] ?? "not_completed";
  return REASON_RANK[reason];
}

// Upcoming Bookings to change first (soonest first), then Children who
// need a Tutor (the bot can't book them; where they rank is an open
// question), then past Bookings to mark (oldest first), then Evaluations
// to book (longest waiting first).
export function sortBookingsTodo(
  bookings: BookingSummary[],
  children: ChildSummary[],
  needingTutor: ChildSummary[] = [],
): BookingTodo[] {
  const byRankThenDate = [...bookings].sort(
    (a, b) =>
      getBookingRank(a) - getBookingRank(b) ||
      `${a.scheduled_date}${a.start_time}`.localeCompare(`${b.scheduled_date}${b.start_time}`),
  );
  const oldestFirst = [...children].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return [
    ...byRankThenDate
      .filter((booking) => getBookingRank(booking) === 0)
      .map((booking): BookingTodo => ({ kind: "booking", id: booking.id, booking })),
    ...needingTutor.map((child): BookingTodo => ({ kind: "needs-tutor", id: child.id, child })),
    ...byRankThenDate
      .filter((booking) => getBookingRank(booking) !== 0)
      .map((booking): BookingTodo => ({ kind: "booking", id: booking.id, booking })),
    ...oldestFirst.map((child): BookingTodo => ({ kind: "evaluation", id: child.id, child })),
  ];
}

// "Science Grade 3 · Reading Kindergarten"
export function formatLevels(child: ChildSummary): string {
  return child.levels
    .map((level) => `${level.name} ${level.level === 0 ? "Kindergarten" : `Grade ${level.level}`}`)
    .join(" · ");
}

export function formatWaiting(child: ChildSummary): string {
  const days = Math.floor(
    (new Date(NOW).getTime() - new Date(child.created_at).getTime()) / MS_PER_DAY,
  );
  let label = `Waiting ${days} days`;
  if (days < 1) {
    label = "New today";
  } else if (days === 1) {
    label = "Waiting 1 day";
  }
  return label;
}

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const TAKEOVER_WINDOW_HOURS = 24;
const BUSINESS_TIME_ZONE = "America/New_York";

export const FLAG_REASON_LABEL: Record<FlagReason, AttentionReason> = {
  booking_request: "Wants to book",
  question: "Has a question",
  guardian_link_request: "Link request",
  reactivation_request: "Reactivation request",
  stuck: "Bot got stuck",
  parse_error: "Bot didn't understand",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  tutor: "Tutor",
  developer: "Developer",
};

// "15:00:00" → "3:00 PM"
export function formatClock(time: string): string {
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(
  date: string,
  options: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" },
): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", options);
}

// "Thu, Oct 15 – Fri, Oct 16", "Sat, Oct 17 · 2:00 PM – 5:00 PM"
export function formatTimeOffDates(item: ExceptionRead): string {
  const start = formatDate(item.start_date);
  let label =
    item.start_date === item.end_date
      ? start
      : `${start} – ${formatDate(item.end_date)}`;
  if (item.start_time && item.end_time) {
    label = `${label} · ${formatClock(item.start_time)} – ${formatClock(item.end_time)}`;
  }
  return label;
}

export function getDisplayName(chat: ConversationSummary): string {
  return chat.guardian?.name ?? formatPhone(chat.phone_number);
}

// "+13055550142" → "(305) 555-0142"
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export type TakeoverWindow = { isOpen: boolean; minutesLeft: number };

// Approximated from `last_message_at`: the list has no
// `last_client_message_at` (only the detail does). See the report.
export function getTakeoverWindow(chat: ConversationSummary): TakeoverWindow {
  const elapsed =
    (new Date(NOW).getTime() - new Date(chat.last_message_at).getTime()) /
    MS_PER_MINUTE;
  const minutesLeft = Math.round(TAKEOVER_WINDOW_HOURS * MINUTES_PER_HOUR - elapsed);
  return { isOpen: minutesLeft > 0, minutesLeft };
}

export function formatWindowLeft(minutesLeft: number): string {
  const hours = Math.floor(minutesLeft / MINUTES_PER_HOUR);
  return hours >= 1
    ? `Takeover closes in ${hours}h`
    : `Takeover closes in ${minutesLeft} min`;
}

// Closest to losing its window first; closed windows go last.
export function sortChatsByWindow(
  chats: ConversationSummary[],
): ConversationSummary[] {
  const rank = (chat: ConversationSummary): number => {
    const takeover = getTakeoverWindow(chat);
    return takeover.isOpen ? takeover.minutesLeft : Number.MAX_SAFE_INTEGER;
  };
  return [...chats].sort((a, b) => rank(a) - rank(b));
}

// Minutes since midnight, from "HH:MM:SS" or the NOW instant.
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

// Read off the string, not a Date, so the viewer's own timezone can't
// move the business clock.
export function getNowMinutes(): number {
  return toMinutes(NOW.slice(11, 19));
}

const NOON_MINUTES = 12 * MINUTES_PER_HOUR;
const EVENING_MINUTES = 17 * MINUTES_PER_HOUR;

export function getGreeting(): string {
  const now = getNowMinutes();
  let greeting = "Good evening";
  if (now < NOON_MINUTES) {
    greeting = "Good morning";
  } else if (now < EVENING_MINUTES) {
    greeting = "Good afternoon";
  }
  return greeting;
}

export function isPast(booking: BookingSummary): boolean {
  return booking.scheduled_date < TODAY || toMinutes(booking.end_time) <= getNowMinutes();
}

export function isHappeningNow(booking: BookingSummary): boolean {
  const now = getNowMinutes();
  return toMinutes(booking.start_time) <= now && now < toMinutes(booking.end_time);
}

// Next one first: upcoming (and in progress) in time order, then the
// ones already over, dimmed, at the bottom.
export function sortForToday(bookings: BookingSummary[]): BookingSummary[] {
  const byStart = [...bookings].sort((a, b) => a.start_time.localeCompare(b.start_time));
  return [
    ...byStart.filter((booking) => !isPast(booking)),
    ...byStart.filter((booking) => isPast(booking)),
  ];
}

export function getLocationLabel(booking: BookingSummary): string {
  return booking.home ? booking.home.address.split(",")[0] : "In office";
}

export function getSubjectLabel(booking: BookingSummary): string {
  let label = "Evaluation";
  if (booking.subject) {
    label = booking.subject_level
      ? `${booking.subject.name} · Grade ${booking.subject_level}`
      : booking.subject.name;
  }
  return label;
}

export function formatUpdatedAt(at: Date): string {
  return at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  });
}
