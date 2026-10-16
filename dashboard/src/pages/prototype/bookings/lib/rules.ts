// The API's read and write rules, faked over the in-memory data so the
// prototype behaves like the real endpoints: sort-out reasons, the list
// query (?q= ?kind= ?user_id= ?status= ?to_sort_out=), free times, and
// the warning contract of POST/PUT /api/bookings.
import {
  APPROVED_TIME_OFF,
  AVAILABILITY,
  CHILDREN,
  NOW_TIME,
  STAFF,
  TODAY,
} from "@/pages/prototype/bookings/lib/mock-data";
import {
  formatTimeRange,
  fromMinutes,
  getWeekday,
  toMinutes,
} from "@/pages/prototype/bookings/lib/format";
import type {
  BookingCreate,
  BookingDetail,
  BookingKind,
  BookingPage,
  BookingStatus,
  BookingSummary,
  BookingWarning,
  ChildSummary,
  ExceptionRead,
  SlotRead,
  SortOutReason,
  UserRole,
} from "@/pages/prototype/bookings/lib/wire";

const SLOT_STEP_MINUTES = 30;
const PAGE_SIZE = 100;

export function isLive(status: BookingStatus): boolean {
  return status === "pending" || status === "confirmed";
}

function isUpcoming(booking: BookingDetail): boolean {
  return (
    booking.scheduled_date > TODAY ||
    (booking.scheduled_date === TODAY && booking.start_time >= NOW_TIME)
  );
}

export function isPast(booking: { scheduled_date: string; end_time: string }): boolean {
  return (
    booking.scheduled_date < TODAY ||
    (booking.scheduled_date === TODAY && booking.end_time <= NOW_TIME)
  );
}

type TimeWindow = {
  userId: string;
  date: string;
  start: string;
  end: string;
};

// Same overlap as the API: whole-day Time off blocks the day, a partial
// one only its window; touching times don't clash.
export function findTimeOff(window: TimeWindow): ExceptionRead | null {
  return (
    APPROVED_TIME_OFF.find(
      (timeOff) =>
        timeOff.staff.id === window.userId &&
        timeOff.start_date <= window.date &&
        timeOff.end_date >= window.date &&
        (timeOff.start_time === null ||
          timeOff.end_time === null ||
          (timeOff.start_time < window.end && timeOff.end_time > window.start)),
    ) ?? null
  );
}

export function findTimeOffFor(booking: BookingDetail): ExceptionRead | null {
  return findTimeOff({
    userId: booking.staff.id,
    date: booking.scheduled_date,
    start: booking.start_time,
    end: booking.end_time,
  });
}

function isStaffArchived(userId: string): boolean {
  return STAFF.find((staff) => staff.id === userId)?.archived ?? false;
}

export function getSortOutReasons(booking: BookingDetail): SortOutReason[] {
  const reasons: SortOutReason[] = [];
  if (!isLive(booking.status)) return reasons;

  if (booking.scheduled_date < TODAY) reasons.push("not_completed");
  if (findTimeOffFor(booking) && !booking.clash_acknowledged_at) {
    reasons.push("time_off_clash");
  }
  if (isUpcoming(booking) && isStaffArchived(booking.staff.id)) {
    reasons.push("archived_staff");
  }
  return reasons;
}

export function toSummary(detail: BookingDetail): BookingSummary {
  return {
    id: detail.id,
    child: { id: detail.child.id, name: detail.child.name },
    staff: detail.staff,
    kind: detail.kind,
    location: detail.location,
    subject: detail.subject,
    subject_level: detail.subject_level,
    scheduled_date: detail.scheduled_date,
    start_time: detail.start_time,
    end_time: detail.end_time,
    status: detail.status,
    notes: detail.notes,
    home: detail.home
      ? { id: detail.home.id, label: detail.home.label, address: detail.home.address }
      : null,
    sort_out_reasons: detail.sort_out_reasons,
    clash_acknowledged_by: detail.clash_acknowledged_by,
    clash_acknowledged_at: detail.clash_acknowledged_at,
    updated_at: detail.updated_at,
  };
}

export type BookingQuery = {
  from: string | null;
  to: string | null;
  q: string;
  kinds: BookingKind[];
  userIds: string[];
  statuses: BookingStatus[];
  isToSortOut: boolean;
};

export const EMPTY_QUERY: BookingQuery = {
  from: null,
  to: null,
  q: "",
  kinds: [],
  userIds: [],
  statuses: [],
  isToSortOut: false,
};

export function buildQueryString(query: BookingQuery): string {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.q.trim()) params.set("q", query.q.trim());
  query.kinds.forEach((kind) => params.append("kind", kind));
  query.userIds.forEach((id) => params.append("user_id", id));
  query.statuses.forEach((status) => params.append("status", status));
  if (query.isToSortOut) params.set("to_sort_out", "true");
  params.set("page_size", String(PAGE_SIZE));
  return `GET /api/bookings?${params.toString()}`;
}

function matchesQuery(
  booking: BookingDetail,
  query: BookingQuery,
  callerId: string,
  callerRole: UserRole,
): boolean {
  const needle = query.q.trim().toLowerCase();
  // A Manager sorts out only their own Bookings (sort_out_staff_limit).
  const isOwnOnly = query.isToSortOut && callerRole === "manager";
  return (
    (!query.from || booking.scheduled_date >= query.from) &&
    (!query.to || booking.scheduled_date <= query.to) &&
    (needle === "" ||
      booking.child.name.toLowerCase().includes(needle) ||
      booking.staff.name.toLowerCase().includes(needle)) &&
    (query.kinds.length === 0 || query.kinds.includes(booking.kind)) &&
    (query.userIds.length === 0 || query.userIds.includes(booking.staff.id)) &&
    (query.statuses.length === 0 || query.statuses.includes(booking.status)) &&
    (!query.isToSortOut || booking.sort_out_reasons.length > 0) &&
    (!isOwnOnly || booking.staff.id === callerId)
  );
}

export function listBookings(
  bookings: BookingDetail[],
  query: BookingQuery,
  callerId: string,
  callerRole: UserRole,
): BookingPage {
  const matched = bookings
    .filter((booking) => matchesQuery(booking, query, callerId, callerRole))
    .sort((a, b) =>
      `${a.scheduled_date}${a.start_time}`.localeCompare(`${b.scheduled_date}${b.start_time}`),
    );
  const items = matched.slice(0, PAGE_SIZE).map(toSummary);
  return {
    items,
    total: matched.length,
    page: 1,
    page_size: PAGE_SIZE,
    counts_by_kind: {
      regular: matched.filter((booking) => booking.kind === "regular").length,
      evaluation: matched.filter((booking) => booking.kind === "evaluation").length,
    },
  };
}

function overlaps(booking: BookingDetail, window: TimeWindow): boolean {
  return (
    booking.staff.id === window.userId &&
    booking.scheduled_date === window.date &&
    isLive(booking.status) &&
    booking.start_time < window.end &&
    booking.end_time > window.start
  );
}

// GET /api/slots/available for one Staff member and day.
export function getFreeSlots(
  bookings: BookingDetail[],
  userId: string,
  date: string,
  lengthMinutes: number,
  ignoreBookingId: string | null,
): SlotRead[] {
  const staff = STAFF.find((item) => item.id === userId);
  if (!staff) return [];

  const others = bookings.filter((booking) => booking.id !== ignoreBookingId);
  const ranges = AVAILABILITY.filter(
    (range) => range.userId === userId && range.weekday === getWeekday(date),
  );
  return ranges.flatMap((range) => {
    const slots: SlotRead[] = [];
    for (
      let start = toMinutes(range.from);
      start + lengthMinutes <= toMinutes(range.to);
      start += SLOT_STEP_MINUTES
    ) {
      const window = {
        userId,
        date,
        start: fromMinutes(start),
        end: fromMinutes(start + lengthMinutes),
      };
      const isTaken = others.some((booking) => overlaps(booking, window));
      if (!isTaken && !findTimeOff(window)) {
        slots.push({
          tutor_id: staff.tutor_id ?? staff.id,
          tutor_name: staff.name,
          availability_id: range.id,
          date,
          start_time: window.start,
          end_time: window.end,
        });
      }
    }
    return slots;
  });
}

export type WriteCheck = {
  // A refusal no confirmation can lift (409 overlap, 422 shape).
  error: string | null;
  warnings: BookingWarning[];
};

// What POST/PUT /api/bookings would answer, before confirm_warnings.
export function checkWrite(
  bookings: BookingDetail[],
  body: BookingCreate,
  editingId: string | null,
): WriteCheck {
  const staff = STAFF.find((item) => item.id === body.user_id);
  const window = {
    userId: body.user_id,
    date: body.scheduled_date,
    start: body.start_time,
    end: body.end_time,
  };
  const clash = bookings.find(
    (booking) => booking.id !== editingId && overlaps(booking, window),
  );
  let error: string | null = null;
  if (clash) {
    error = `${clash.staff.name} already has ${clash.child.name} at ${formatTimeRange(clash.start_time, clash.end_time)}. Pick another time or Staff.`;
  }

  const warnings: BookingWarning[] = [];
  const isTeaching = body.kind === "regular" && staff?.role !== "admin";
  if (isTeaching && !body.availability_id) {
    warnings.push({
      code: "outside_slot",
      message: `This time is outside ${staff?.name ?? "their"}’s availability.`,
    });
  }
  const timeOff = findTimeOff(window);
  if (timeOff) {
    warnings.push({
      code: "time_off",
      message: `${timeOff.staff.name} has approved Time off that day (${timeOff.reason ?? "no reason given"}).`,
    });
  }
  const teaches = staff?.subjects.some((subject) => subject.id === body.subject_id);
  if (body.kind === "regular" && staff && !teaches) {
    warnings.push({
      code: "grade_ceiling",
      message: `${staff.name} isn’t set up to teach this subject at this level.`,
    });
  }
  return { error, warnings };
}

// GET /api/children?evaluable=true: not Evaluated, no live Evaluation,
// oldest first. "Evaluations to book" and the Evaluation Child picker.
export function getEvaluableChildren(bookings: BookingDetail[]): ChildSummary[] {
  return CHILDREN.filter(
    (child) =>
      !child.evaluated &&
      !bookings.some(
        (booking) =>
          booking.child.id === child.id &&
          booking.kind === "evaluation" &&
          isLive(booking.status),
      ),
  ).sort((a, b) => a.created_at.localeCompare(b.created_at));
}
