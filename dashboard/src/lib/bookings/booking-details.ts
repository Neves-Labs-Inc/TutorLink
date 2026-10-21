// The rules behind Booking details: which acts a Booking offers, who to
// tell about a change, and the words each act uses (DESIGN §11.4, §11.6).
import { BUSINESS_TIME_ZONE, formatClock, formatDay } from "@/components/kit/format";
import type {
  BookingDetail,
  BookingGuardian,
  BookingStatus,
  ClashingTimeOff,
  StaffRole,
} from "@/lib/queries/bookings";

export type BookingAct =
  | "complete"
  | "didnt_happen"
  | "change"
  | "keep"
  | "cancel"
  | "reopen"
  | "restore";

// Acts that write; Change booking only hands the Booking to the form.
export type WriteAct = Exclude<BookingAct, "change"> | "stop_keeping";

const LIVE_STATUSES: ReadonlySet<BookingStatus> = new Set([
  "pending",
  "confirmed",
]);

const MARKED_STATUSES: ReadonlySet<BookingStatus> = new Set([
  "completed",
  "didnt_happen",
]);

export const STATUS_WORDS: Record<BookingStatus, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  didnt_happen: "Didn’t happen",
};

export const ROLE_WORDS: Record<StaffRole, string> = {
  tutor: "Tutor",
  manager: "Manager",
  admin: "Admin",
};

// "2026-10-21T15:30" on the business's clock, comparable with a Booking's
// naive date and time.
export function getBusinessNow(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: BUSINESS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function getStart(booking: BookingDetail): string {
  return `${booking.scheduled_date}T${booking.start_time.slice(0, 5)}`;
}

export function hasStarted(booking: BookingDetail, now: Date): boolean {
  return getStart(booking) <= getBusinessNow(now);
}

type ActRules = { canKeep: boolean; now: Date };

// The footer's acts, primary first. The first Needs attention reason
// decides them; otherwise the status and the clock do.
export function getBookingActs(
  booking: BookingDetail,
  { canKeep, now }: ActRules,
): BookingAct[] {
  const firstReason = booking.sort_out_reasons[0];
  const isLive = LIVE_STATUSES.has(booking.status);
  // The API never moves a Pending booking to Completed.
  const marks: BookingAct[] =
    booking.status === "pending" ? ["didnt_happen"] : ["complete", "didnt_happen"];
  let acts: BookingAct[] = [];
  if (firstReason === "not_completed") {
    acts = marks;
  } else if (firstReason === "time_off_clash") {
    acts = canKeep ? ["change", "keep"] : ["change"];
  } else if (firstReason === "archived_staff") {
    acts = ["change", "cancel"];
  } else if (isLive && hasStarted(booking, now)) {
    acts = marks;
  } else if (isLive) {
    acts = ["change", "cancel"];
  } else if (MARKED_STATUSES.has(booking.status)) {
    acts = ["reopen"];
  } else if (booking.status === "cancelled" && !hasStarted(booking, now)) {
    acts = ["restore"];
  }
  return acts;
}

export function getFirstName(name: string): string {
  return name.split(" ")[0];
}

export type GuardianToTell = { name: string; conversationId: string | null };

// The Guardian who booked it, else the first one. The chat is theirs, else
// the first Guardian's that has one.
export function getGuardianToTell(booking: BookingDetail): GuardianToTell {
  const booker = booking.booked_by_guardian;
  const guardian: BookingGuardian | null =
    booking.guardians.find((each) => each.id === booker?.id) ??
    booking.guardians[0] ??
    null;
  const withChat =
    guardian?.conversation_id
      ? guardian
      : booking.guardians.find((each) => each.conversation_id !== null);
  const name = booker?.name ?? guardian?.name ?? "the Guardian";
  return {
    name: name === "the Guardian" ? name : getFirstName(name),
    conversationId: withChat?.conversation_id ?? null,
  };
}

// "Thu, Oct 15 at 3:30 PM".
export function describeBookingTime(booking: BookingDetail): string {
  const day = formatDay(booking.scheduled_date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day} at ${formatClock(booking.start_time)}`;
}

export function describeTimeOff(timeOff: ClashingTimeOff): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  let dates = formatDay(timeOff.start_date, options);
  if (timeOff.end_date !== timeOff.start_date) {
    dates = `${dates} – ${formatDay(timeOff.end_date, options)}`;
  }
  if (timeOff.start_time && timeOff.end_time) {
    dates = `${dates}, ${formatClock(timeOff.start_time)} – ${formatClock(timeOff.end_time)}`;
  }
  return `Time off: ${dates}`;
}

// "Thu, Oct 8, 2:14 PM" on the business's clock, for an aware timestamp.
export function formatShortDateTime(at: string): string {
  return new Date(at).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

// "Oct 14" on the business's calendar, for an aware timestamp.
export function formatShortDate(at: string): string {
  return new Date(at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

const MINUTES_PER_HOUR = 60;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

export function getDurationMinutes(booking: BookingDetail): number {
  return toMinutes(booking.end_time) - toMinutes(booking.start_time);
}

// The alert line while open, and the error toast once closed.
export const ACT_FAILED: Record<WriteAct, string> = {
  complete: "Couldn’t mark it Completed. Try again.",
  didnt_happen: "Couldn’t mark it Didn’t happen. Try again.",
  keep: "Couldn’t keep the booking. Try again.",
  cancel: "Couldn’t cancel the booking. Try again.",
  reopen: "Couldn’t re-open it. Try again.",
  restore: "Couldn’t restore it. Try again.",
  stop_keeping: "Couldn’t stop keeping it. Try again.",
};

const ACT_FAILED_AFTER_CLOSE: Record<WriteAct, (child: string) => string> = {
  complete: (child) => `Couldn’t mark ${child}’s booking Completed.`,
  didnt_happen: (child) => `Couldn’t mark ${child}’s booking Didn’t happen.`,
  keep: (child) => `Couldn’t keep ${child}’s booking.`,
  cancel: (child) => `Couldn’t cancel ${child}’s booking.`,
  reopen: (child) => `Couldn’t re-open ${child}’s booking.`,
  restore: (child) => `Couldn’t restore ${child}’s booking.`,
  stop_keeping: (child) => `Couldn’t stop keeping ${child}’s booking.`,
};

export function getClosedFailure(act: WriteAct, booking: BookingDetail): string {
  const child = getFirstName(booking.child.name);
  return `${ACT_FAILED_AFTER_CLOSE[act](child)} Open it and try again.`;
}

export const STALE_MESSAGE =
  "Someone else changed this booking. It’s been reloaded.";

export const UNDO_FAILED = "Couldn’t undo. The booking has changed since.";

// The API's restore refusals (`booking_status.py`) in the Office's words.
const CHILD_ARCHIVED_DETAIL = /restore the child/i;
const STAFF_ARCHIVED_DETAIL = /staff member is archived/i;

type RestoreRefusal = { isOverlap: boolean; detail: string | null };

export function describeRestoreRefusal(
  { isOverlap, detail }: RestoreRefusal,
  booking: BookingDetail,
): string {
  const staff = getFirstName(booking.staff.name);
  let message = ACT_FAILED.restore;
  if (isOverlap) {
    message = `Can’t restore: ${staff} has another booking at that time.`;
  } else if (detail && CHILD_ARCHIVED_DETAIL.test(detail)) {
    message = `Can’t restore: ${getFirstName(booking.child.name)} is archived.`;
  } else if (detail && STAFF_ARCHIVED_DETAIL.test(detail)) {
    message = `Can’t restore: ${staff} is archived.`;
  }
  return message;
}
