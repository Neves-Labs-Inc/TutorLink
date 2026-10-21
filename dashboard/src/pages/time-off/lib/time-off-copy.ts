// Time off in words: the one status sentence (what it means for the
// person, the pain point Tutors had) and the dates and length.
import {
  BUSINESS_TIME_ZONE,
  formatClock,
  formatDay,
  pluralize,
} from "@/components/kit/format";
import type {
  ExceptionRead,
  NamedRef,
  TimeOffDecision,
} from "@/lib/queries/time-off";

type Window = Pick<
  ExceptionRead,
  "start_date" | "end_date" | "start_time" | "end_time"
>;

const MS_PER_DAY = 86_400_000;
const MINUTES_PER_HOUR = 60;

export function getFirstName(name: string): string {
  return name.split(" ")[0];
}

// "Oct 14, 3:10 PM", when it was asked, decided or cancelled.
export function formatStamp(at: string): string {
  return new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

function formatDate(dayKey: string): string {
  return formatDay(dayKey, { weekday: "short", month: "short", day: "numeric" });
}

// "Mon, Oct 20 – Wed, Oct 22", plus " · 1:00 PM – 5:00 PM" for part days.
export function formatTimeOffDates(window: Window): string {
  const first = formatDate(window.start_date);
  const dates =
    window.start_date === window.end_date
      ? first
      : `${first} – ${formatDate(window.end_date)}`;
  const hours =
    window.start_time && window.end_time
      ? ` · ${formatClock(window.start_time)} – ${formatClock(window.end_time)}`
      : "";
  return `${dates}${hours}`;
}

// "Mon, Oct 20, 3:30 PM", a clashing Booking's start.
export function formatBookingStart(dayKey: string, time: string): string {
  return `${formatDate(dayKey)}, ${formatClock(time)}`;
}

function getDayCount(window: Window): number {
  const start = new Date(`${window.start_date}T12:00:00`).getTime();
  const end = new Date(`${window.end_date}T12:00:00`).getTime();
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return [
    hours > 0 ? pluralize(hours, "hour", "hours") : "",
    minutes > 0 ? pluralize(minutes, "minute", "minutes") : "",
  ]
    .filter(Boolean)
    .join(" ");
}

// "3 days", or "4 hours on each day" for a part-day window.
export function formatTimeOffLength(window: Window): string {
  const dayCount = getDayCount(window);
  if (!window.start_time || !window.end_time) {
    return pluralize(dayCount, "day", "days");
  }

  const duration = formatDuration(
    toMinutes(window.end_time) - toMinutes(window.start_time),
  );
  return dayCount > 1 ? `${duration} on each day` : duration;
}

// "you" to the actor themselves, else their first name.
function nameActor(actor: NamedRef | null, viewerId: string, fallback: string): string {
  if (!actor) return fallback;
  return actor.id === viewerId ? "you" : getFirstName(actor.name);
}

function getApprovedSentence(item: ExceptionRead, viewerId: string): string {
  const entered = item.entered_by;
  const holder = item.staff.id === viewerId ? "You" : "They";
  const blocked = `${holder} can’t be booked in these times.`;
  // An Admin's own entry is approved by the same act that made it.
  const isSelfEntered =
    entered?.id === item.staff.id && item.decided_by?.id === entered.id;
  const isEnteredForThem = entered !== null && entered.id !== item.staff.id;

  let sentence = `Approved by ${nameActor(item.decided_by, viewerId, "an Admin")}, ${formatStamp(item.decided_at ?? item.created_at)}. ${blocked}`;
  if (isSelfEntered) {
    sentence =
      "Took effect straight away: an Admin’s own time off needs no approval.";
  } else if (isEnteredForThem) {
    sentence = `Added by ${nameActor(entered, viewerId, "an Admin")}, so it took effect straight away. ${blocked}`;
  }
  return sentence;
}

// The status in one sentence, worded for `viewerId`.
export function getStatusSentence(item: ExceptionRead, viewerId: string): string {
  const isOwn = item.staff.id === viewerId;
  const decider = nameActor(item.decided_by, viewerId, "an Admin");
  const canceller = nameActor(item.cancelled_by, viewerId, "someone");
  const decidedAt = formatStamp(item.decided_at ?? item.created_at);
  const cancelledAt = formatStamp(item.cancelled_at ?? item.created_at);

  const sentences: Record<ExceptionRead["status"], () => string> = {
    pending: () =>
      isOwn
        ? "Waiting for an Admin. You can still be booked until it’s approved."
        : "Waiting for an Admin to approve or decline.",
    approved: () => getApprovedSentence(item, viewerId),
    rejected: () =>
      `Declined by ${decider}, ${decidedAt}. ${isOwn ? "You" : "They"} can still be booked.`,
    cancelled: () => `Cancelled by ${canceller}, ${cancelledAt}.`,
    expired: () => "Nobody decided before it started, so it never took effect.",
  };
  return sentences[item.status]();
}

type DecisionCopy = { message: string; errorMessage: string };

// The Undo toast and its failure for Approve or Decline. Never the
// viewer's own: nobody decides their own request. An approval with
// clashes says where those Bookings went.
export function getDecisionCopy(
  item: ExceptionRead,
  decision: TimeOffDecision,
): DecisionCopy {
  const whose = `${getFirstName(item.staff.name)}’s`;
  const [done, verb] =
    decision === "approved" ? ["Approved", "approve"] : ["Declined", "decline"];
  const count = item.clashing_bookings_count;
  const clashNote =
    decision === "approved" && count > 0
      ? ` ${pluralize(count, "Booking", "Bookings")} to change, now in To do.`
      : "";
  return {
    message: `${done} ${whose} time off.${clashNote}`,
    errorMessage: `Couldn’t ${verb} ${whose} time off. Open it and try again.`,
  };
}
