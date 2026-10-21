// The rules behind New booking and Change booking (DESIGN §11.5): who the
// Staff picker offers and how it describes them, the Assigned Tutor
// warning, which Availability a typed time names, and the request bodies.
import { formatClock, formatDay } from "@/components/kit/format";
import { dayOfWeekFromIso } from "@/lib/availability/availability";
import { getFirstName, ROLE_WORDS } from "@/lib/bookings/booking-details";
import type { AvailabilitySlot } from "@/lib/queries/availability";
import type {
  BookingCreate,
  BookingKind,
  BookingLocation,
  BookingReplace,
  NamedRef,
  WarningCode,
} from "@/lib/queries/bookings";
import type { OfficeTimeOff } from "@/lib/queries/exceptions";
import type { AvailableSlot } from "@/lib/queries/slots";
import type { StaffRead } from "@/lib/queries/staff";

export type BookingFormPrefill = {
  kind?: BookingKind;
  childId?: string;
  subjectId?: string;
  date?: string;
  startTime?: string;
  userId?: string;
};

export type BookingFormFields = {
  kind: BookingKind;
  childId: string | null;
  subjectId: string | null;
  date: string;
  userId: string | null;
  // "15:30:00", or "" while unset.
  startTime: string;
  endTime: string;
  // Set by a free-time chip; a typed time names its range at submit.
  availabilityId: string | null;
  isTypedTime: boolean;
  location: BookingLocation;
  homeId: string | null;
  notes: string;
};

export type FieldName = "child" | "subject" | "staff" | "date" | "time" | "home";

export const FIELD_ERRORS: Record<FieldName, string> = {
  child: "Pick a Child.",
  subject: "Pick a Subject.",
  staff: "Pick who teaches it.",
  date: "Pick a date.",
  time: "Pick a free time, or set a start and end time.",
  home: "Pick which home.",
};

// The fields top to bottom, so the first invalid one takes focus.
export const FIELD_ORDER: FieldName[] = [
  "child",
  "subject",
  "date",
  "staff",
  "time",
  "home",
];

export const DEFAULT_SESSION_MINUTES = 60;

const MINUTES_PER_HOUR = 60;
const MS_PER_DAY = 86_400_000;

type Rank = 0 | 1 | 2;

export type StaffChoice = { staff: StaffRead; description: string };

type StaffChoicesInput = {
  kind: BookingKind;
  staff: StaffRead[];
  // The Child's Assigned Tutors, by user id.
  assignedIds: string[];
  subject: NamedRef | null;
  date: string;
  // The day's free times for every Staff member; null while unknown.
  slots: AvailableSlot[] | null;
  timeOff: OfficeTimeOff[];
};

function isOffOn(userId: string, timeOff: OfficeTimeOff[]): boolean {
  return timeOff.some((entry) => entry.staff.id === userId);
}

function describeOff(date: string): string {
  return `Off ${formatDay(date, { weekday: "long" })} (Time off)`;
}

// A Tutoring session names an Availability range, so only those with a
// teaching profile (and Admins, who name none) can take one.
function canTeach(staff: StaffRead): boolean {
  return staff.role === "admin" || staff.tutor_id !== null;
}

function teachesSubject(staff: StaffRead, subject: NamedRef | null): boolean {
  return subject !== null && staff.subjects.some((each) => each.id === subject.id);
}

// One chip's identity: a range can hold many start times.
export function getSlotKey(slot: Pick<AvailableSlot, "availability_id" | "start_time">): string {
  return `${slot.availability_id}-${slot.start_time}`;
}

export function getSlotsFor(
  staff: StaffRead,
  slots: AvailableSlot[],
): AvailableSlot[] {
  return slots
    .filter((slot) => staff.tutor_id !== null && slot.tutor_id === staff.tutor_id)
    .toSorted((a, b) => a.start_time.localeCompare(b.start_time));
}

function describeTeaching(staff: StaffRead, input: StaffChoicesInput): string {
  const { subject, slots } = input;
  let line = ROLE_WORDS[staff.role];
  if (isOffOn(staff.id, input.timeOff)) {
    line = describeOff(input.date);
  } else if (subject !== null && !teachesSubject(staff, subject)) {
    line = `Not set up for ${subject.name}`;
  } else if (subject !== null && staff.role === "admin") {
    line = `Teaches ${subject.name} · no set availability`;
  } else if (subject !== null && slots === null) {
    line = `Teaches ${subject.name}`;
  } else if (subject !== null && slots !== null) {
    const [first] = getSlotsFor(staff, slots);
    line = first
      ? `Teaches ${subject.name} · free from ${formatClock(first.start_time)}`
      : `Teaches ${subject.name} · no free time that day`;
  }
  return line;
}

// Tutoring: Assigned Tutors first, then those who teach the Subject, then
// the rest. Evaluations go to the office: Admins and Managers only.
export function getStaffChoices(input: StaffChoicesInput): StaffChoice[] {
  if (input.kind === "evaluation") {
    return input.staff
      .filter((staff) => staff.role === "admin" || staff.role === "manager")
      .map((staff) => ({
        staff,
        description: isOffOn(staff.id, input.timeOff)
          ? describeOff(input.date)
          : ROLE_WORDS[staff.role],
      }));
  }

  const rankOf = (staff: StaffRead): Rank => {
    let rank: Rank = 2;
    if (input.assignedIds.includes(staff.id)) {
      rank = 0;
    } else if (teachesSubject(staff, input.subject)) {
      rank = 1;
    }
    return rank;
  };
  return input.staff
    .filter(canTeach)
    .toSorted((a, b) => rankOf(a) - rankOf(b))
    .map((staff) => {
      const prefix = input.assignedIds.includes(staff.id) ? "Assigned Tutor · " : "";
      return { staff, description: `${prefix}${describeTeaching(staff, input)}` };
    });
}

type AssignedTutorNoteInput = {
  child: { name: string };
  assigned: NamedRef[];
  picked: Pick<StaffRead, "id" | "name" | "role"> | null;
};

// Assigned Tutors on the office form (TutorLink#242): a warning, never a
// block. Null when there is nothing to warn about.
export function describeAssignedTutorNote({
  child,
  assigned,
  picked,
}: AssignedTutorNoteInput): string | null {
  const childFirst = getFirstName(child.name);
  const pickedFirst = picked ? getFirstName(picked.name) : "";
  const names = assigned.map((tutor) => tutor.name).join(", ");
  const isAssigned = assigned.some((tutor) => tutor.id === picked?.id);
  const botLine = `You can still book; the bot won’t offer ${pickedFirst} to ${childFirst}’s family.`;
  let note: string | null = null;
  if (assigned.length === 0) {
    const whom = picked ? `${pickedFirst}; assign Tutors on ${childFirst}’s details.` : "anyone.";
    note = `${childFirst} has no Assigned Tutors, so the bot hands their requests to the office. You can still book ${whom}`;
  } else if (picked && picked.role === "admin") {
    note = `${pickedFirst} is an Admin, so never one of ${childFirst}’s Assigned Tutors (${names}). ${botLine}`;
  } else if (picked && !isAssigned) {
    note = `${pickedFirst} isn’t one of ${childFirst}’s Assigned Tutors (${names}). ${botLine}`;
  }
  return note;
}

function isInside(range: AvailabilitySlot, start: string, end: string): boolean {
  return range.start_time <= start && range.end_time >= end;
}

// The range a typed time names. A Tutor's or Manager's session must name
// one; a time outside it comes back as the confirmable `outside_slot`
// warning, so the nearest fit (that day, else any) still lets them book.
export function pickAvailabilityId(
  ranges: AvailabilitySlot[],
  date: string,
  start: string,
  end: string,
): string | null {
  const active = ranges.filter((range) => range.is_active);
  const thatDay = active.filter((range) => range.day_of_week === dayOfWeekFromIso(date));
  const range =
    thatDay.find((each) => isInside(each, start, end)) ?? thatDay[0] ?? active[0] ?? null;
  return range?.id ?? null;
}

// Time off that covers any of start..end on the day (null times: all day).
export function isOffDuring(
  userId: string,
  timeOff: OfficeTimeOff[],
  start: string,
  end: string,
): boolean {
  return timeOff.some(
    (entry) =>
      entry.staff.id === userId &&
      (entry.start_time === null ||
        entry.end_time === null ||
        (entry.start_time < end && entry.end_time > start)),
  );
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * MINUTES_PER_HOUR + minutes;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// "15:30:00" plus 60 is "16:30:00"; capped at the day's end.
export function addMinutes(time: string, minutes: number): string {
  const total = Math.min(toMinutes(time) + minutes, 24 * MINUTES_PER_HOUR - 1);
  return `${pad(Math.floor(total / MINUTES_PER_HOUR))}:${pad(total % MINUTES_PER_HOUR)}:00`;
}

export function getLengthMinutes(slot: { start_time: string; end_time: string }): number {
  return toMinutes(slot.end_time) - toMinutes(slot.start_time);
}

export function getDaysWaiting(createdAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / MS_PER_DAY));
}

export function getMissingFields(fields: BookingFormFields): FieldName[] {
  const isTimeSet =
    fields.startTime !== "" && fields.endTime !== "" && fields.endTime > fields.startTime;
  const checks: [FieldName, boolean][] = [
    ["child", fields.childId !== null],
    ["subject", fields.kind === "evaluation" || fields.subjectId !== null],
    ["staff", fields.userId !== null],
    ["date", fields.date !== ""],
    ["time", isTimeSet],
    ["home", fields.location === "in_office" || fields.homeId !== null],
  ];
  return checks.filter(([, isSet]) => !isSet).map(([field]) => field);
}

type WriteParts = {
  fields: BookingFormFields;
  availabilityId: string | null;
  confirmed: WarningCode[];
};

function toWriteBody({ fields, availabilityId, confirmed }: WriteParts): Omit<BookingReplace, "notes"> {
  const isRegular = fields.kind === "regular";
  const isHome = fields.location === "home";
  return {
    kind: fields.kind,
    user_id: fields.userId ?? "",
    location: fields.location,
    home_id: isHome ? fields.homeId : null,
    subject_id: isRegular ? fields.subjectId : null,
    availability_id: isRegular ? availabilityId : null,
    scheduled_date: fields.date,
    start_time: fields.startTime,
    end_time: fields.endTime,
    confirm_warnings: confirmed,
  };
}

export function toCreateBody(parts: WriteParts): BookingCreate {
  const notes = parts.fields.notes.trim();
  const body: BookingCreate = {
    child_id: parts.fields.childId ?? "",
    ...toWriteBody(parts),
  };
  if (notes !== "") body.notes = notes;
  return body;
}

// No Child (PUT refuses it). Notes always go: null clears them.
export function toReplaceBody(parts: WriteParts, expectedUpdatedAt: string): BookingReplace {
  const notes = parts.fields.notes.trim();
  return {
    ...toWriteBody(parts),
    notes: notes === "" ? null : notes,
    expected_updated_at: expectedUpdatedAt,
  };
}
