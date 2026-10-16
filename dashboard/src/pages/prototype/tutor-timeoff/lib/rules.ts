// The API's read-time rules, mirrored for the mock: Expired, Time off
// clashes, a Booking's sort-out reasons, and which list a request sits
// in. Business time is naive wall-clock strings, so plain string order.
import { NOW, TODAY } from "@/pages/prototype/shell-kit/kit/mock-data";
import type {
  BookingDetail,
  BookingSummary,
  ClashingBooking,
  ExceptionRead,
} from "@/pages/prototype/tutor-timeoff/types/api";
import type { ExceptionRow } from "@/pages/prototype/tutor-timeoff/lib/mock-data";

export { NOW, TODAY };

type Window = Pick<
  ExceptionRead,
  "start_date" | "end_date" | "start_time" | "end_time"
>;

export function hasEnded(window: Window): boolean {
  return window.end_time === null
    ? window.end_date < TODAY
    : `${window.end_date}T${window.end_time}` <= NOW;
}

export function hasStarted(booking: BookingSummary): boolean {
  return `${booking.scheduled_date}T${booking.start_time}` <= NOW;
}

export function hasFinished(booking: BookingSummary): boolean {
  return `${booking.scheduled_date}T${booking.end_time}` <= NOW;
}

export function isLive(booking: BookingSummary): boolean {
  return booking.status === "pending" || booking.status === "confirmed";
}

// Unmarked: its time has passed and it is still live.
export function isUnmarked(session: BookingSummary): boolean {
  return isLive(session) && hasFinished(session);
}

// A part-day window covers the same hours on each of its days.
function overlaps(window: Window, booking: BookingSummary): boolean {
  const isInDates =
    booking.scheduled_date >= window.start_date &&
    booking.scheduled_date <= window.end_date;
  if (!isInDates) return false;
  if (window.start_time === null || window.end_time === null) return true;
  return booking.start_time < window.end_time && booking.end_time > window.start_time;
}

export function findClashes(
  staffId: string,
  window: Window,
  bookings: BookingDetail[],
): ClashingBooking[] {
  return bookings
    .filter(
      (booking) =>
        booking.staff.id === staffId &&
        isLive(booking) &&
        !hasStarted(booking) &&
        overlaps(window, booking),
    )
    .map((booking) => ({
      booking_id: booking.id,
      date: booking.scheduled_date,
      start_time: booking.start_time,
      end_time: booking.end_time,
      child_name: booking.child.name,
      status: booking.status,
    }));
}

// The wire read: `expired` for a pending row that has ended, and clashes
// only while the row is pending (not Expired) or approved.
export function readException(
  row: ExceptionRow,
  bookings: BookingDetail[],
): ExceptionRead {
  const isExpired = row.status === "pending" && hasEnded(row);
  const status = isExpired ? "expired" : row.status;
  const hasClashes = status === "pending" || status === "approved";
  const clashes = hasClashes ? findClashes(row.staff.id, row, bookings) : [];
  return {
    ...row,
    status,
    clashing_bookings: clashes,
    clashing_bookings_count: clashes.length,
  };
}

// A Booking's reasons, as GET /api/bookings computes them.
export function readBooking(
  booking: BookingDetail,
  approvedTimeOff: ExceptionRow[],
): BookingDetail {
  const isUnmarked = isLive(booking) && booking.scheduled_date < TODAY;
  const isClashing =
    isLive(booking) &&
    !hasStarted(booking) &&
    approvedTimeOff.some(
      (row) => row.staff.id === booking.staff.id && overlaps(row, booking),
    );
  const reasons: BookingDetail["sort_out_reasons"] = [
    ...(isUnmarked ? (["not_completed"] as const) : []),
    ...(isClashing ? (["time_off_clash"] as const) : []),
  ];
  return { ...booking, sort_out_reasons: reasons };
}

export type QueueTab = "pending" | "upcoming" | "past";

// Admin queue tabs. Upcoming is approved and not over; Past is the rest.
export function getQueueTab(item: ExceptionRead): QueueTab {
  let tab: QueueTab = "past";
  if (item.status === "pending") {
    tab = "pending";
  } else if (item.status === "approved" && !hasEnded(item)) {
    tab = "upcoming";
  }
  return tab;
}

export function compareByStart(a: ExceptionRead, b: ExceptionRead): number {
  return (
    a.start_date.localeCompare(b.start_date) ||
    (a.start_time ?? "").localeCompare(b.start_time ?? "")
  );
}

// The owner or an Admin may cancel pending or approved Time off that
// hasn't ended.
export function canCancel(item: ExceptionRead): boolean {
  return (item.status === "pending" || item.status === "approved") && !hasEnded(item);
}

// Only Admins decide. A declined request can still be approved while it
// hasn't ended (CONTEXT.md, Time off).
export function canApprove(item: ExceptionRead): boolean {
  return (item.status === "pending" || item.status === "rejected") && !hasEnded(item);
}

export function canDecline(item: ExceptionRead): boolean {
  return item.status === "pending";
}
