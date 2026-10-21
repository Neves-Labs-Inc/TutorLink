// The Bookings tab's rows in words, and the "from now" cut.
import { formatClock, formatDay } from "@/components/kit/format";
import type { BookingSummary } from "@/lib/queries/bookings";
import { getBusinessNow } from "@/pages/time-off/lib/time-off-rules";

export const STAFF_BOOKINGS_LIMIT = 10;

export type BookingWhen = { day: string; range: string };

// "Mon, Oct 20" and "3:30 PM – 4:30 PM", shown as "Mon, Oct 20 · 3:30 PM – 4:30 PM".
export function formatBookingWhen(booking: BookingSummary): BookingWhen {
  const day = formatDay(booking.scheduled_date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return {
    day,
    range: `${formatClock(booking.start_time)} – ${formatClock(booking.end_time)}`,
  };
}

// "Emma · Maths · Garcia home" (an Evaluation has no subject).
export function formatBookingWhat(booking: BookingSummary): string {
  const topic = booking.kind === "evaluation" ? "Evaluation" : booking.subject?.name;
  const place =
    booking.location === "in_office" ? "In office" : (booking.home?.label ?? "Home");
  return [booking.child.name, topic, place].filter(Boolean).join(" · ");
}

// The API filters by day, so today's sessions already started are cut here.
export function getUpcomingBookings(
  items: BookingSummary[],
  now: string = getBusinessNow(),
): BookingSummary[] {
  return items
    .filter((booking) => `${booking.scheduled_date}T${booking.start_time}` > now)
    .slice(0, STAFF_BOOKINGS_LIMIT);
}
