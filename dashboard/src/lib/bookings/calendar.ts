// What the Bookings calendar shows, worked out from the wire: the week's
// days, who is off, which Staff get a Day by Staff column and when they
// are free. Dates are business "YYYY-MM-DD" keys and times "HH:MM:SS".
import { BUSINESS_TIME_ZONE } from "@/components/kit/format";
import type { GridBlock } from "@/components/kit/components/time-grid";
import { dayOfWeekFromIso } from "@/lib/availability/availability";
import { formatTime } from "@/lib/dates/dates";
import type { AvailabilitySlot } from "@/lib/queries/availability";
import type { BookingSummary } from "@/lib/queries/bookings";
import type { OfficeTimeOff } from "@/lib/queries/exceptions";
import type { Staff } from "@/lib/queries/staff";
import { addDays } from "@/lib/week";

const DAYS_IN_WEEK = 7;
const EVALUATION_LABEL = "Evaluation";

export type TimeBand = { start: string; end: string };

export type DayStaff = {
  id: string;
  name: string;
  isArchived: boolean;
  isOff: boolean;
  freeBands: TimeBand[];
};

export function getWeekDays(weekStart: string): string[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
    addDays(weekStart, index),
  );
}

// The business's wall clock now, whatever the viewer's time zone.
export function getBusinessTime(now: Date): string {
  return now.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

export function getFirstName(name: string): string {
  return name.split(" ")[0];
}

export function getWhat(booking: BookingSummary): string {
  if (booking.kind === "evaluation" || !booking.subject) return EVALUATION_LABEL;
  return booking.subject.name;
}

export function getBookingsOn(
  bookings: BookingSummary[],
  day: string,
): BookingSummary[] {
  return bookings
    .filter((booking) => booking.scheduled_date === day)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export function needsAttention(booking: BookingSummary): boolean {
  return booking.status !== "cancelled" && booking.sort_out_reasons.length > 0;
}

// Approved Time off covering `day`, limited to the picked Staff (if any).
export function getTimeOffOn(
  timeOff: OfficeTimeOff[],
  day: string,
  userIds: string[],
): OfficeTimeOff[] {
  return timeOff.filter(
    (off) =>
      off.start_date <= day &&
      off.end_date >= day &&
      (userIds.length === 0 || userIds.includes(off.staff.id)),
  );
}

export function toGridBlock(
  booking: BookingSummary,
  showsStaff: boolean,
): GridBlock {
  const isEvaluation = booking.kind === "evaluation";
  return {
    id: booking.id,
    startTime: booking.start_time,
    endTime: booking.end_time,
    time: formatTime(booking.start_time),
    name: booking.child.name,
    what: getWhat(booking),
    isEvaluation,
    staffName: booking.staff.name,
    showsStaff,
    status: booking.status,
    reason: booking.sort_out_reasons[0],
    tone: isEvaluation ? "pink" : "primary",
  };
}

function getFreeBands(slots: AvailabilitySlot[], day: string): TimeBand[] {
  const weekday = dayOfWeekFromIso(day);
  return slots
    .filter((slot) => slot.is_active && slot.day_of_week === weekday)
    .map((slot) => ({ start: slot.start_time, end: slot.end_time }));
}

type DayStaffInput = {
  day: string;
  bookings: BookingSummary[];
  // Active Staff, in the order the columns should run; null while unknown.
  activeStaff: Staff[] | null;
  timeOff: OfficeTimeOff[];
  // Availability by tutor profile id.
  availability: Map<string, AvailabilitySlot[]>;
  userIds: string[];
};

// A column per active Staff member with a Booking, Availability or Time
// off that day, plus archived Staff who still hold a Booking that day.
// With a Staff filter and nobody left, the filtered active Staff.
export function getDayStaff({
  day,
  bookings,
  activeStaff,
  timeOff,
  availability,
  userIds,
}: DayStaffInput): DayStaff[] {
  const dayBookings = getBookingsOn(bookings, day);
  const offIds = new Set(getTimeOffOn(timeOff, day, []).map((off) => off.staff.id));
  const bookedIds = new Set(dayBookings.map((booking) => booking.staff.id));
  const activeIds = new Set((activeStaff ?? []).map((person) => person.id));

  const active: DayStaff[] = (activeStaff ?? []).map((person) => {
    const isOff = offIds.has(person.id);
    const slots = person.tutor_id ? (availability.get(person.tutor_id) ?? []) : [];
    return {
      id: person.id,
      name: person.name,
      isArchived: false,
      isOff,
      freeBands: isOff ? [] : getFreeBands(slots, day),
    };
  });
  const others: DayStaff[] = [
    ...new Map(
      dayBookings
        .filter((booking) => !activeIds.has(booking.staff.id))
        .map((booking) => [booking.staff.id, booking.staff]),
    ).values(),
  ].map((person) => ({
    id: person.id,
    name: person.name,
    // Until the Staff list loads nobody can be told apart as archived.
    isArchived: activeStaff !== null,
    isOff: offIds.has(person.id),
    freeBands: [],
  }));

  const isPicked = (person: DayStaff): boolean =>
    userIds.length === 0 || userIds.includes(person.id);
  const withDay = [...active, ...others].filter(
    (person) =>
      (person.isOff || person.freeBands.length > 0 || bookedIds.has(person.id)) &&
      isPicked(person),
  );
  // A Staff filter keeps its people's columns, so the grid can still book them.
  return withDay.length === 0 && userIds.length > 0
    ? active.filter(isPicked)
    : withDay;
}
