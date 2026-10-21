// New booking and Change booking: what each picker offers, the fields,
// and the submit cycle (check → 409 warnings → "Book anyway" resends
// with confirm_warnings), the stale-save reload, and the toasts.
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getTodayKey } from "@/components/kit/format";
import { useToast } from "@/components/kit/overlays/use-toast";
import { conflictOf, errorDetail, errorStatus } from "@/lib/api";
import { ADMIN_ROLES } from "@/lib/auth/auth";
import {
  describeBookingTime,
  getFirstName,
  getGuardianToTell,
} from "@/lib/bookings/booking-details";
import {
  addMinutes,
  DEFAULT_SESSION_MINUTES,
  describeAssignedTutorNote,
  FIELD_ERRORS,
  FIELD_ORDER,
  getDaysWaiting,
  getLengthMinutes,
  getMissingFields,
  getSlotsFor,
  getStaffChoices,
  isOffDuring,
  pickAvailabilityId,
  toCreateBody,
  toReplaceBody,
} from "@/lib/bookings/booking-form";
import type {
  BookingFormFields,
  BookingFormPrefill,
  FieldName,
  StaffChoice,
} from "@/lib/bookings/booking-form";
import { availabilityQueries } from "@/lib/queries/availability";
import {
  bookingQueries,
  createBooking,
  invalidateBookingData,
  updateBooking,
} from "@/lib/queries/bookings";
import type {
  BookingDetail,
  BookingKind,
  BookingWarning,
  WarningCode,
} from "@/lib/queries/bookings";
import { gradeLabel } from "@/lib/children/children";
import { childQueries } from "@/lib/queries/children";
import type { ChildSummary } from "@/lib/queries/children";
import { officeTimeOffQueries } from "@/lib/queries/exceptions";
import { familyQueries } from "@/lib/queries/families";
import { settingQueries } from "@/lib/queries/settings";
import { slotQueries } from "@/lib/queries/slots";
import type { AvailableSlot } from "@/lib/queries/slots";
import { staffQueries } from "@/lib/queries/staff";
import type { StaffRead } from "@/lib/queries/staff";
import { useAuthStore } from "@/stores/authStore";
import type { ChildDetail } from "@/types/families";

// The API's page cap; the booking pickers filter the whole list locally.
const CHILD_PAGE_SIZE = 100;
const SESSION_LENGTH_KEY = "session_length_minutes";
const CHILD_NOT_EVALUATED = /must be Evaluated/i;
const SAVE_FAILED_AFTER_CLOSE = "Couldn’t save the booking. Open it and try again.";

export type BookingFormTarget =
  | { mode: "new"; prefill: BookingFormPrefill }
  | { mode: "change"; bookingId: string };

export type FormRefusal = { title: string; body: string };

export type ChildChoice = Pick<ChildSummary, "id" | "name"> & { description: string };

type OptionList<T> = { items: T[]; isLoading: boolean; isError: boolean; retry: () => void };

export type FreeTimes =
  | { state: "none" }
  | { state: "loading" }
  | { state: "error"; retry: () => void }
  | { state: "ready"; slots: AvailableSlot[] };

type UseBookingFormOptions = {
  target: BookingFormTarget;
  isOpen: boolean;
  onClose: () => void;
  // A Change saved: its details come back.
  onChanged: (bookingId: string) => void;
  onOpenBooking: (bookingId: string) => void;
  onOpenChat: (conversationId: string) => void;
};

export type BookingFormState = {
  isChange: boolean;
  isFormLoading: boolean;
  loadError: { message: string; retry: () => void; isRetrying: boolean } | null;
  booking: BookingDetail | null;
  fields: BookingFormFields;
  child: ChildDetail | null;
  children: OptionList<ChildChoice>;
  staff: OptionList<StaffChoice>;
  pickedStaff: StaffRead | null;
  // Change booking: the Booking's Staff member is archived.
  isStaffArchived: boolean;
  freeTimes: FreeTimes;
  // The picked Staff member's free times that day.
  chips: AvailableSlot[];
  lengthMinutes: number;
  assignedTutorNote: string | null;
  // Change booking: who can take it at its time when its Staff can't.
  swap: { staffName: string; startTime: string; options: StaffRead[] } | null;
  errors: Partial<Record<FieldName, string>>;
  // A new object on each refused submit: the field to focus.
  invalidFocus: { field: FieldName } | null;
  warnings: BookingWarning[];
  refusal: FormRefusal | null;
  isStale: boolean;
  isReloading: boolean;
  isSaving: boolean;
  setKind: (kind: BookingKind) => void;
  setChild: (childId: string) => void;
  setSubject: (subjectId: string) => void;
  setDate: (date: string) => void;
  setStaff: (userId: string) => void;
  setStart: (time: string) => void;
  setEnd: (time: string) => void;
  pickSlot: (slot: AvailableSlot) => void;
  setTypedTime: (isTyped: boolean) => void;
  setPlace: (value: string) => void;
  setNotes: (notes: string) => void;
  submit: () => Promise<void>;
  reload: () => Promise<void>;
};

const IN_OFFICE = "in_office";

function toSeconds(time: string | undefined): string {
  if (!time) return "";
  return time.length === 5 ? `${time}:00` : time;
}

function getPrefillFields(prefill: BookingFormPrefill): BookingFormFields {
  const kind = prefill.kind ?? "regular";
  const startTime = toSeconds(prefill.startTime);
  return {
    kind,
    childId: prefill.childId ?? null,
    subjectId: prefill.subjectId ?? null,
    date: prefill.date ?? getTodayKey(),
    userId: prefill.userId ?? null,
    startTime,
    // Empty follows the session length from the start.
    endTime: "",
    availabilityId: null,
    isTypedTime: startTime !== "",
    // Tutoring moves to the Child's first Home once their detail is in.
    location: "in_office",
    homeId: null,
    notes: "",
  };
}

function getBookingFields(booking: BookingDetail, isStaffArchived: boolean): BookingFormFields {
  return {
    kind: booking.kind,
    childId: booking.child.id,
    subjectId: booking.subject?.id ?? null,
    date: booking.scheduled_date,
    userId: isStaffArchived ? null : booking.staff.id,
    startTime: booking.start_time,
    endTime: booking.end_time,
    availabilityId: null,
    isTypedTime: true,
    location: booking.location,
    homeId: booking.home?.id ?? null,
    notes: booking.notes ?? "",
  };
}

// The Child's defaults once their detail is known: the first Subject
// level, and the first live Home for Tutoring (In office otherwise).
function getChildDefaults(
  fields: BookingFormFields,
  child: ChildDetail,
): Partial<BookingFormFields> {
  const levels = child.levels.filter((level) => !level.archived);
  const home = child.homes.find((each) => !each.archived) ?? null;
  const isHome = fields.kind === "regular" && home !== null;
  const hasSubject = levels.some((level) => level.subject_id === fields.subjectId);
  return {
    subjectId: hasSubject ? fields.subjectId : (levels[0]?.subject_id ?? null),
    location: isHome ? "home" : "in_office",
    homeId: isHome ? home.id : null,
  };
}

function toChildChoice(child: ChildSummary, kind: BookingKind, now: number): ChildChoice {
  const days = getDaysWaiting(child.created_at, new Date(now));
  const grade = gradeLabel(child.grade_level);
  return {
    id: child.id,
    name: child.name,
    description:
      kind === "evaluation"
        ? `${grade} · waiting ${days} ${days === 1 ? "day" : "days"}`
        : child.guardians.map((guardian) => guardian.name).join(", "),
  };
}

export function useBookingForm({
  target,
  isOpen,
  onClose,
  onChanged,
  onOpenBooking,
  onOpenChat,
}: UseBookingFormOptions): BookingFormState {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const role = useAuthStore((state) => state.role);
  const isChange = target.mode === "change";
  const bookingId = target.mode === "change" ? target.bookingId : null;
  const [fields, setFields] = useState<BookingFormFields>(() =>
    target.mode === "new" ? getPrefillFields(target.prefill) : getPrefillFields({}),
  );
  // The booking (by updated_at) or Child the fields were last filled from.
  const [filledFrom, setFilledFrom] = useState<string | null>(null);
  const [defaultsFor, setDefaultsFor] = useState<string | null>(
    target.mode === "change" ? "booking" : null,
  );
  const [submitCount, setSubmitCount] = useState(0);
  const [invalidFocus, setInvalidFocus] = useState<{ field: FieldName } | null>(null);
  const [warnings, setWarnings] = useState<BookingWarning[]>([]);
  const [confirmed, setConfirmed] = useState<WarningCode[]>([]);
  const [refusal, setRefusal] = useState<FormRefusal | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [now] = useState(() => Date.now());
  // A save can settle after the form closed; this says whether it's open.
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const bookingQuery = useQuery({
    ...bookingQueries.detail(bookingId ?? ""),
    enabled: bookingId !== null,
  });
  const booking = bookingQuery.data ?? null;
  const staffQuery = useQuery(staffQueries.active());
  const activeStaff = staffQuery.data?.items ?? [];
  const isStaffArchived =
    booking !== null &&
    staffQuery.isSuccess &&
    !activeStaff.some((each) => each.id === booking.staff.id);

  // Change booking fills in once the Booking and the Staff list are in.
  const isStaffSettled = staffQuery.isSuccess || staffQuery.isError;
  if (booking && isStaffSettled && filledFrom === null) {
    setFilledFrom(booking.updated_at);
    setFields(getBookingFields(booking, isStaffArchived));
  }

  const evaluatedQuery = useQuery({
    ...childQueries.list({ evaluated: true, page_size: CHILD_PAGE_SIZE }),
    enabled: !isChange,
  });
  const evaluableQuery = useQuery({
    ...childQueries.list({ evaluable: true, page_size: CHILD_PAGE_SIZE }),
    enabled: !isChange,
  });
  const childListQuery = fields.kind === "evaluation" ? evaluableQuery : evaluatedQuery;

  const childQuery = useQuery({
    ...familyQueries.child(fields.childId ?? ""),
    enabled: fields.childId !== null,
  });
  const child = childQuery.data?.id === fields.childId ? childQuery.data : null;
  if (child && defaultsFor !== child.id && defaultsFor !== "booking") {
    setDefaultsFor(child.id);
    setFields((current) => ({ ...current, ...getChildDefaults(current, child) }));
  }

  const subjectLevel = child?.levels.find((level) => level.subject_id === fields.subjectId);
  const subject = subjectLevel ? { id: subjectLevel.subject_id, name: subjectLevel.name } : null;
  const isRegular = fields.kind === "regular";
  const slotsQuery = useQuery({
    ...slotQueries.available({
      subject_id: fields.subjectId ?? "",
      date: fields.date,
      child_id: fields.childId ?? undefined,
      exclude_booking_id: bookingId ?? undefined,
    }),
    enabled: isRegular && fields.subjectId !== null && fields.childId !== null && fields.date !== "",
  });
  const slots = slotsQuery.data?.items ?? null;
  const timeOffQuery = useQuery({
    ...officeTimeOffQueries.approved(fields.date, fields.date),
    enabled: fields.date !== "",
  });
  const timeOff = timeOffQuery.data?.items ?? [];
  // Settings are Admin-only; a Manager's form reads the length off a slot.
  const settingsQuery = useQuery({
    ...settingQueries.list(),
    enabled: role !== null && ADMIN_ROLES.includes(role),
  });
  const settingLength = Number(
    settingsQuery.data?.find((setting) => setting.key === SESSION_LENGTH_KEY)?.value,
  );

  const staffChoices = getStaffChoices({
    kind: fields.kind,
    staff: activeStaff,
    assignedIds: (child?.assigned_tutors ?? []).map((tutor) => tutor.id),
    subject,
    date: fields.date,
    slots,
    timeOff,
  });
  const pickedStaff = activeStaff.find((each) => each.id === fields.userId) ?? null;
  const chips = isRegular && pickedStaff && slots ? getSlotsFor(pickedStaff, slots) : [];
  const firstSlot = chips[0] ?? slots?.[0];
  let lengthMinutes = DEFAULT_SESSION_MINUTES;
  if (firstSlot) {
    lengthMinutes = getLengthMinutes(firstSlot);
  } else if (Number.isFinite(settingLength) && settingLength > 0) {
    lengthMinutes = settingLength;
  }
  const effectiveFields: BookingFormFields = {
    ...fields,
    endTime:
      fields.endTime === "" && fields.startTime !== ""
        ? addMinutes(fields.startTime, lengthMinutes)
        : fields.endTime,
  };

  let freeTimes: FreeTimes = { state: "none" };
  if (isRegular && pickedStaff && slotsQuery.isPending && slotsQuery.fetchStatus !== "idle") {
    freeTimes = { state: "loading" };
  } else if (isRegular && pickedStaff && slotsQuery.isError) {
    freeTimes = { state: "error", retry: () => void slotsQuery.refetch() };
  } else if (isRegular && pickedStaff && slots) {
    freeTimes = { state: "ready", slots: chips };
  }

  const childList = (childListQuery.data?.items ?? []).map((each) =>
    toChildChoice(each, fields.kind, now),
  );
  // A prefilled Child still shows while the list loads or leaves them out.
  if (child && !childList.some((each) => each.id === child.id)) {
    childList.unshift({ id: child.id, name: child.name, description: "" });
  }

  const assignedTutorNote =
    isRegular && child
      ? describeAssignedTutorNote({ child, assigned: child.assigned_tutors, picked: pickedStaff })
      : null;

  const isBookingStaffOff =
    booking !== null &&
    isOffDuring(booking.staff.id, timeOff, effectiveFields.startTime, effectiveFields.endTime);
  let swap: BookingFormState["swap"] = null;
  if (
    booking &&
    effectiveFields.startTime !== "" &&
    (isStaffArchived || isBookingStaffOff) &&
    (fields.userId === null || fields.userId === booking.staff.id)
  ) {
    const startTime = effectiveFields.startTime;
    const isFree = (each: StaffRead): boolean =>
      isRegular
        ? (slots ?? []).some(
            (slot) => slot.tutor_id === each.tutor_id && slot.start_time === startTime,
          )
        : !isOffDuring(each.id, timeOff, startTime, effectiveFields.endTime);
    swap = {
      staffName: booking.staff.name,
      startTime,
      options: staffChoices
        .map((choice) => choice.staff)
        .filter((each) => each.id !== booking.staff.id && isFree(each)),
    };
  }

  const missing = getMissingFields(effectiveFields);
  const errors: Partial<Record<FieldName, string>> = {};
  if (submitCount > 0) {
    for (const field of missing) errors[field] = FIELD_ERRORS[field];
  }

  let loadError: BookingFormState["loadError"] = null;
  if (isChange && bookingQuery.isError) {
    loadError = {
      message: "Couldn’t load this booking. Check your connection and try again.",
      retry: () => void bookingQuery.refetch(),
      isRetrying: bookingQuery.isFetching,
    };
  } else if (fields.childId !== null && childQuery.isError) {
    loadError = {
      message: "Couldn’t load this Child. Check your connection and try again.",
      retry: () => void childQuery.refetch(),
      isRetrying: childQuery.isFetching,
    };
  }
  // Only the prefilled Child holds the form; a later pick or a Kind
  // switch that clears them never does.
  const isPrefilledChildLoading =
    !isChange &&
    target.prefill.childId !== undefined &&
    fields.childId === target.prefill.childId &&
    child === null &&
    !childQuery.isError;
  const isFormLoading =
    loadError === null && ((isChange && filledFrom === null) || isPrefilledChildLoading);

  // Any edit makes the last check stale.
  function update(change: Partial<BookingFormFields>): void {
    setFields((current) => ({ ...current, ...change }));
    setWarnings([]);
    setConfirmed([]);
    setRefusal(null);
  }

  function isEligible(childId: string, kind: BookingKind): boolean {
    const list = kind === "evaluation" ? evaluableQuery.data : evaluatedQuery.data;
    if (list) return list.items.some((each) => each.id === childId);
    const evaluated = child?.id === childId ? child.evaluated : null;
    return kind === "evaluation" ? evaluated === null : evaluated !== null;
  }

  function setKind(kind: BookingKind): void {
    const childId = fields.childId && isEligible(fields.childId, kind) ? fields.childId : null;
    const kept = childId !== null && child?.id === childId ? child : null;
    const next = { ...fields, kind, childId };
    const place: Partial<BookingFormFields> = kept
      ? getChildDefaults(next, kept)
      : { location: "in_office", homeId: null };
    update({ kind, childId, userId: null, availabilityId: null, ...place });
    if (childId === null) setDefaultsFor(null);
  }

  function setChild(childId: string): void {
    setDefaultsFor(null);
    update({ childId, subjectId: null, homeId: null, availabilityId: null });
  }

  // A picked chip's time belongs to that Staff, day and Subject: changing
  // one drops it, so Book asks for a new pick instead of a hidden time.
  function unpickChip(): Partial<BookingFormFields> {
    return fields.isTypedTime
      ? { availabilityId: null }
      : { availabilityId: null, startTime: "", endTime: "" };
  }

  function setStart(time: string): void {
    const startTime = toSeconds(time);
    update({
      startTime,
      endTime: startTime === "" ? "" : addMinutes(startTime, lengthMinutes),
      availabilityId: null,
    });
  }

  function pickSlot(slot: AvailableSlot): void {
    update({
      startTime: slot.start_time,
      endTime: slot.end_time,
      availabilityId: slot.availability_id,
      isTypedTime: false,
    });
  }

  function setPlace(value: string): void {
    update(value === IN_OFFICE ? { location: "in_office", homeId: null } : { location: "home", homeId: value });
  }

  // A chip names its range; a typed time looks up the one it sits in.
  async function resolveAvailabilityId(): Promise<string | null> {
    if (!isRegular || !pickedStaff || pickedStaff.role === "admin" || pickedStaff.tutor_id === null) {
      return null;
    }
    if (!fields.isTypedTime && fields.availabilityId !== null) return fields.availabilityId;
    const ranges = await queryClient.fetchQuery(availabilityQueries.forTutor(pickedStaff.tutor_id));
    const picked = pickAvailabilityId(
      ranges.items,
      effectiveFields.date,
      effectiveFields.startTime,
      effectiveFields.endTime,
    );
    return picked ?? (booking?.staff.id === pickedStaff.id ? booking.availability_id : null);
  }

  function describeRefusal(error: unknown): FormRefusal {
    const detail = errorDetail(error);
    const conflict = conflictOf(error);
    const staffFirst = getFirstName(pickedStaff?.name ?? booking?.staff.name ?? "They");
    const childName = child?.name ?? booking?.child.name ?? "This Child";
    let result: FormRefusal = {
      title: isChange ? "Couldn’t save the booking" : "Couldn’t book",
      body: detail ?? "Check your connection and try again.",
    };
    if (conflict?.kind === "overlap") {
      result = { title: `${staffFirst} already has a booking then`, body: detail ?? "Pick another time." };
    } else if (errorStatus(error) !== null && CHILD_NOT_EVALUATED.test(detail ?? "")) {
      result = {
        title: `${getFirstName(childName)} isn’t Evaluated yet`,
        body: detail ?? "Book an Evaluation first.",
      };
    }
    return result;
  }

  async function save(): Promise<void> {
    const availabilityId = await resolveAvailabilityId();
    const parts = { fields: effectiveFields, availabilityId, confirmed };
    if (booking) {
      const saved = await updateBooking(booking.id, toReplaceBody(parts, filledFrom ?? booking.updated_at));
      queryClient.setQueryData(bookingQueries.detail(saved.id).queryKey, saved);
      void invalidateBookingData(queryClient);
      const guardian = getGuardianToTell(saved);
      if (isOpenRef.current) onChanged(saved.id);
      const conversationId = guardian.conversationId;
      showToast({
        tone: "success",
        message: `Booking changed. Let ${guardian.name} know.`,
        ...(conversationId === null
          ? {}
          : { actionLabel: "Open chat", onAction: () => onOpenChat(conversationId) }),
      });
      return;
    }
    const created = await createBooking(toCreateBody(parts));
    void invalidateBookingData(queryClient);
    if (isOpenRef.current) onClose();
    const when = describeBookingTime(created);
    showToast({
      tone: "success",
      message: `Booked ${getFirstName(child?.name ?? "")} with ${getFirstName(pickedStaff?.name ?? "")}, ${when}.`,
      actionLabel: "Open",
      onAction: () => onOpenBooking(created.id),
    });
  }

  async function submit(): Promise<void> {
    if (isSaving) return;
    setSubmitCount((count) => count + 1);
    const firstMissing = FIELD_ORDER.find((field) => missing.includes(field));
    if (firstMissing) {
      setInvalidFocus({ field: firstMissing });
      return;
    }
    setIsSaving(true);
    setRefusal(null);
    try {
      await save();
    } catch (error) {
      const conflict = conflictOf(error);
      if (!isOpenRef.current) {
        showToast({ tone: "error", message: SAVE_FAILED_AFTER_CLOSE });
      } else if (conflict?.kind === "warnings") {
        setWarnings(conflict.warnings);
        setConfirmed(conflict.warnings.map((warning) => warning.code));
      } else if (isChange && conflict?.kind === "stale") {
        setIsStale(true);
      } else {
        // A refusal won't change on a resend, so "Book anyway" goes too.
        setWarnings([]);
        setConfirmed([]);
        setRefusal(describeRefusal(error));
      }
    } finally {
      setIsSaving(false);
    }
  }

  // Drops the edits for the Booking as it is now.
  async function reload(): Promise<void> {
    setIsReloading(true);
    try {
      const fresh = await bookingQuery.refetch();
      if (fresh.data) {
        setFilledFrom(fresh.data.updated_at);
        setFields(getBookingFields(fresh.data, isStaffArchived));
        setIsStale(false);
        setWarnings([]);
        setConfirmed([]);
        setRefusal(null);
        setSubmitCount(0);
      }
    } finally {
      setIsReloading(false);
    }
  }

  return {
    isChange,
    isFormLoading,
    loadError,
    booking,
    fields: effectiveFields,
    child,
    children: {
      items: childList,
      isLoading: !isChange && childListQuery.isPending,
      isError: childListQuery.isError,
      retry: () => void childListQuery.refetch(),
    },
    staff: {
      items: staffChoices,
      isLoading: staffQuery.isPending,
      isError: staffQuery.isError,
      retry: () => void staffQuery.refetch(),
    },
    pickedStaff,
    isStaffArchived,
    freeTimes,
    chips,
    lengthMinutes,
    assignedTutorNote,
    swap,
    errors,
    invalidFocus,
    warnings,
    refusal,
    isStale,
    isReloading,
    isSaving,
    setKind,
    setChild,
    setSubject: (subjectId) => update({ subjectId, ...unpickChip() }),
    setDate: (date) => update({ date, ...unpickChip() }),
    setStaff: (userId) => update({ userId, ...unpickChip() }),
    setStart,
    setEnd: (time) => update({ endTime: toSeconds(time), availabilityId: null }),
    pickSlot,
    setTypedTime: (isTyped) => update({ isTypedTime: isTyped }),
    setPlace,
    setNotes: (notes) => update({ notes }),
    submit,
    reload,
  };
}
