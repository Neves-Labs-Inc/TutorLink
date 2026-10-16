// State for New booking and Change booking: the fields of BookingCreate,
// what each picker offers, the free times, and the submit cycle of the
// warning contract (check → 409 warnings → "Book anyway" resubmits
// with confirm_warnings → saving).
import { useState } from "react";
import {
  AVAILABILITY,
  CHILDREN,
  SESSION_MINUTES,
  STAFF,
} from "@/pages/prototype/bookings/lib/mock-data";
import {
  fromMinutes,
  getWeekday,
  toMinutes,
} from "@/pages/prototype/bookings/lib/format";
import {
  checkWrite,
  findTimeOff,
  getEvaluableChildren,
  getFreeSlots,
} from "@/pages/prototype/bookings/lib/rules";
import type {
  BookingCreate,
  BookingDetail,
  BookingKind,
  BookingLocation,
  BookingWarning,
  ChildSummary,
  SlotRead,
  StaffRead,
  WarningCode,
} from "@/pages/prototype/bookings/lib/wire";

const FAKE_SAVE_MS = 1200;

export type FormStart = {
  kind: BookingKind;
  childId: string | null;
  date: string;
  time: string | null;
  userId: string | null;
};

export type FieldName = "child" | "subject" | "staff" | "date" | "time" | "home";

type Fields = {
  kind: BookingKind;
  childId: string | null;
  subjectId: string | null;
  date: string;
  userId: string | null;
  startTime: string;
  endTime: string;
  availabilityId: string | null;
  isCustomTime: boolean;
  location: BookingLocation;
  homeId: string | null;
  notes: string;
};

export type BookingFormState = {
  fields: Fields;
  child: ChildSummary | null;
  childOptions: ChildSummary[];
  staffOptions: StaffRead[];
  slots: SlotRead[];
  swapOptions: StaffRead[];
  missing: FieldName[];
  showsErrors: boolean;
  error: string | null;
  warnings: BookingWarning[];
  isSaving: boolean;
  body: BookingCreate;
  set: (change: Partial<Fields>) => void;
  setKind: (kind: BookingKind) => void;
  setChild: (childId: string) => void;
  setStaff: (userId: string) => void;
  setStart: (time: string) => void;
  pickSlot: (slot: SlotRead) => void;
  submit: () => void;
};

function getLength(kind: BookingKind): number {
  return SESSION_MINUTES[kind];
}

function addMinutes(time: string, minutes: number): string {
  return fromMinutes(toMinutes(time) + minutes);
}

// The Availability range a time sits in. BookingDetail doesn't return
// availability_id, so Change booking has to find it again.
function findAvailabilityId(
  userId: string | null,
  date: string,
  start: string,
  end: string,
): string | null {
  const range = AVAILABILITY.find(
    (item) =>
      item.userId === userId &&
      item.weekday === getWeekday(date) &&
      `${item.from}:00` <= start &&
      `${item.to}:00` >= end,
  );
  return range?.id ?? null;
}

function getChildDefaults(child: ChildSummary | undefined, kind: BookingKind): Partial<Fields> {
  const home = child?.homes.find((item) => !item.archived) ?? null;
  const isHome = kind === "regular" && home !== null;
  return {
    subjectId: kind === "regular" ? (child?.levels[0]?.subject_id ?? null) : null,
    location: isHome ? "home" : "in_office",
    homeId: isHome ? home.id : null,
  };
}

function getInitialFields(start: FormStart, editing: BookingDetail | null): Fields {
  if (editing) {
    const isArchived = STAFF.find((staff) => staff.id === editing.staff.id)?.archived ?? false;
    const userId = isArchived ? null : editing.staff.id;
    return {
      kind: editing.kind,
      childId: editing.child.id,
      subjectId: editing.subject?.id ?? null,
      date: editing.scheduled_date,
      userId,
      startTime: editing.start_time,
      endTime: editing.end_time,
      availabilityId: findAvailabilityId(userId, editing.scheduled_date, editing.start_time, editing.end_time),
      isCustomTime: true,
      location: editing.location,
      homeId: editing.home?.id ?? null,
      notes: editing.notes ?? "",
    };
  }
  const child = CHILDREN.find((item) => item.id === start.childId);
  const startTime = start.time ?? "";
  return {
    kind: start.kind,
    childId: start.childId,
    subjectId: null,
    date: start.date,
    userId: start.userId,
    startTime,
    endTime: startTime ? addMinutes(startTime, getLength(start.kind)) : "",
    availabilityId: startTime
      ? findAvailabilityId(start.userId, start.date, startTime, addMinutes(startTime, getLength(start.kind)))
      : null,
    isCustomTime: Boolean(startTime),
    notes: "",
    location: "in_office",
    homeId: null,
    ...getChildDefaults(child, start.kind),
  };
}

function getChildOptions(kind: BookingKind, bookings: BookingDetail[]): ChildSummary[] {
  // Tutoring offers Evaluated Children only (placeholder rule).
  return kind === "evaluation"
    ? getEvaluableChildren(bookings)
    : CHILDREN.filter((child) => child.evaluated !== null);
}

function getStaffOptions(fields: Fields): StaffRead[] {
  const active = STAFF.filter((staff) => !staff.archived);
  // Evaluations go to the office: every Admin and Manager, no default.
  if (fields.kind === "evaluation") {
    return active.filter((staff) => staff.role === "admin" || staff.role === "manager");
  }
  const teaches = (staff: StaffRead): boolean =>
    staff.subjects.some((subject) => subject.id === fields.subjectId);
  return [...active.filter(teaches), ...active.filter((staff) => !teaches(staff))];
}

function getMissing(fields: Fields): FieldName[] {
  const missing: FieldName[] = [];
  if (!fields.childId) missing.push("child");
  if (fields.kind === "regular" && !fields.subjectId) missing.push("subject");
  if (!fields.userId) missing.push("staff");
  if (!fields.date) missing.push("date");
  if (!fields.startTime || !fields.endTime || fields.endTime <= fields.startTime) {
    missing.push("time");
  }
  if (fields.location === "home" && !fields.homeId) missing.push("home");
  return missing;
}

type UseBookingFormInput = {
  start: FormStart;
  editing: BookingDetail | null;
  bookings: BookingDetail[];
  onSaved: (body: BookingCreate) => void;
};

export function useBookingForm({
  start,
  editing,
  bookings,
  onSaved,
}: UseBookingFormInput): BookingFormState {
  const [fields, setFields] = useState<Fields>(() => getInitialFields(start, editing));
  const [showsErrors, setShowsErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<BookingWarning[]>([]);
  const [confirmed, setConfirmed] = useState<WarningCode[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const editingId = editing?.id ?? null;
  const length = getLength(fields.kind);
  const child = CHILDREN.find((item) => item.id === fields.childId) ?? null;
  const slots =
    fields.userId && fields.date && fields.kind === "regular"
      ? getFreeSlots(bookings, fields.userId, fields.date, length, editingId)
      : [];

  const body: BookingCreate = {
    user_id: fields.userId ?? "",
    location: fields.location,
    subject_id: fields.kind === "regular" ? fields.subjectId : null,
    availability_id: fields.kind === "regular" ? fields.availabilityId : null,
    home_id: fields.location === "home" ? fields.homeId : null,
    scheduled_date: fields.date,
    start_time: fields.startTime,
    end_time: fields.endTime,
    confirm_warnings: confirmed,
    child_id: fields.childId ?? "",
    kind: fields.kind,
    booked_by_guardian_id: null,
    notes: fields.notes.trim() || null,
  };

  // When the current Staff member is off or gone that day, offer the
  // ones who are free at the same time: Change booking's way out.
  const isStaffUnavailable =
    editing !== null &&
    (fields.userId === null ||
      findTimeOff({ userId: fields.userId, date: fields.date, start: fields.startTime, end: fields.endTime }) !== null);
  const swapOptions = isStaffUnavailable
    ? getStaffOptions(fields).filter(
        (staff) =>
          staff.id !== fields.userId &&
          (fields.kind === "evaluation" ||
            staff.subjects.some((subject) => subject.id === fields.subjectId)) &&
          getFreeSlots(bookings, staff.id, fields.date, length, editingId).some(
            (slot) => slot.start_time === fields.startTime,
          ),
      )
    : [];

  function set(change: Partial<Fields>): void {
    setFields((current) => ({ ...current, ...change }));
    // Any edit makes the last check stale.
    setWarnings([]);
    setConfirmed([]);
    setError(null);
  }

  function setKind(kind: BookingKind): void {
    const eligible = getChildOptions(kind, bookings).some((item) => item.id === fields.childId);
    const childId = eligible ? fields.childId : null;
    const keptChild = CHILDREN.find((item) => item.id === childId);
    set({
      kind,
      childId,
      userId: null,
      availabilityId: null,
      endTime: fields.startTime ? addMinutes(fields.startTime, getLength(kind)) : "",
      ...getChildDefaults(keptChild, kind),
    });
  }

  function setChild(childId: string): void {
    const picked = CHILDREN.find((item) => item.id === childId);
    set({ childId, ...getChildDefaults(picked, fields.kind) });
  }

  function setStaff(userId: string): void {
    set({
      userId,
      availabilityId: findAvailabilityId(userId, fields.date, fields.startTime, fields.endTime),
    });
  }

  function setStart(time: string): void {
    const endTime = time ? addMinutes(time, length) : "";
    set({
      startTime: time,
      endTime,
      availabilityId: findAvailabilityId(fields.userId, fields.date, time, endTime),
    });
  }

  function pickSlot(slot: SlotRead): void {
    set({
      startTime: slot.start_time,
      endTime: slot.end_time,
      availabilityId: slot.availability_id,
      isCustomTime: false,
    });
  }

  function submit(): void {
    if (getMissing(fields).length > 0) {
      setShowsErrors(true);
      return;
    }
    const check = checkWrite(bookings, body, editingId);
    if (check.error) {
      setError(check.error);
      return;
    }
    const unconfirmed = check.warnings.filter(
      (warning) => !confirmed.includes(warning.code),
    );
    if (unconfirmed.length > 0) {
      // The 409: show the warnings; the next press confirms them all.
      setWarnings(check.warnings);
      setConfirmed(check.warnings.map((warning) => warning.code));
      return;
    }
    setIsSaving(true);
    window.setTimeout(() => {
      setIsSaving(false);
      onSaved(body);
    }, FAKE_SAVE_MS);
  }

  return {
    fields,
    child,
    childOptions: getChildOptions(fields.kind, bookings),
    staffOptions: getStaffOptions(fields),
    slots,
    swapOptions,
    missing: getMissing(fields),
    showsErrors,
    error,
    warnings,
    isSaving,
    body,
    set,
    setKind,
    setChild,
    setStaff,
    setStart,
    pickSlot,
    submit,
  };
}

