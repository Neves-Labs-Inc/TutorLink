// The fake API for this area: one in-memory store per role and state,
// with the server's rules (who lands pending, who decides, the 409 clash
// warning) and a little latency so busy states show.
import { useState } from "react";
import type { AvailabilitySlot } from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  AVAILABILITY,
  BOOKINGS,
  COUNTS_BASE,
  ME,
  STAFF,
  TIME_OFF,
} from "@/pages/prototype/tutor-timeoff/lib/mock-data";
import type { AreaRole, ExceptionRow } from "@/pages/prototype/tutor-timeoff/lib/mock-data";
import {
  findClashes,
  hasStarted,
  readBooking,
  readException,
} from "@/pages/prototype/tutor-timeoff/lib/rules";
import {
  diffWeek,
  toWireRows,
} from "@/pages/prototype/tutor-timeoff/lib/availability";
import type {
  AvailabilityRead,
  BookingDetail,
  CountsRead,
  ExceptionCreate,
  ExceptionRead,
  MeRead,
  StaffRead,
  TimeOffWarning,
} from "@/pages/prototype/tutor-timeoff/types/api";

const FAKE_LATENCY_MS = 700;
const NOW_STAMP = "2026-10-13T08:40:00-04:00";

export type Result<T> = { value: T | null; error: string | null; status: number };

// A 409 carries the warnings to confirm alongside the error.
export type WriteResult = Result<ExceptionRead> & { warnings: TimeOffWarning[] };

function wait(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, FAKE_LATENCY_MS));
}

export type AreaStore = {
  me: MeRead;
  staff: StaffRead[];
  bookings: BookingDetail[];
  timeOff: ExceptionRead[];
  availability: AvailabilityRead[];
  counts: CountsRead;
  createTimeOff: (userId: string, body: ExceptionCreate) => Promise<WriteResult>;
  decide: (id: string, status: "approved" | "rejected", isConfirmed: boolean) => Promise<WriteResult>;
  cancel: (id: string) => Promise<Result<ExceptionRead>>;
  markCompleted: (bookingId: string) => Promise<Result<BookingDetail>>;
  saveAvailability: (slots: AvailabilitySlot[]) => Promise<Result<number>>;
};

function clashWarning(count: number): TimeOffWarning[] {
  return [
    {
      code: "booking_clash",
      message: `${count} live ${count === 1 ? "Booking falls" : "Bookings fall"} in this time off`,
    },
  ];
}

export function useAreaStore(role: AreaRole, isEmpty: boolean): AreaStore {
  const me = ME[role];
  const [rows, setRows] = useState<ExceptionRow[]>(() =>
    isEmpty ? [] : TIME_OFF,
  );
  const [bookingRows, setBookingRows] = useState<BookingDetail[]>(() =>
    isEmpty ? [] : BOOKINGS,
  );
  const [slots, setSlots] = useState<AvailabilityRead[]>(() =>
    isEmpty || !me.tutor_id ? [] : (AVAILABILITY[me.tutor_id] ?? []),
  );

  const approved = rows.filter((row) => row.status === "approved");
  const bookings = bookingRows.map((booking) => readBooking(booking, approved));
  const timeOff = rows.map((row) => readException(row, bookingRows));
  const pendingCount = timeOff.filter((item) => item.status === "pending").length;
  const counts: CountsRead = {
    ...COUNTS_BASE,
    // null for a Manager: they have no all-Staff Time off list.
    time_off_pending: role === "admin" ? pendingCount : null,
  };
  const isAdmin = role === "admin";
  const meRef = { id: me.id, name: me.name };

  function updateRow(id: string, patch: Partial<ExceptionRow>): ExceptionRead | null {
    const row = rows.find((item) => item.id === id);
    if (!row) return null;
    const next = { ...row, ...patch };
    setRows((current) => current.map((item) => (item.id === id ? next : item)));
    return readException(next, bookingRows);
  }

  async function createTimeOff(userId: string, body: ExceptionCreate): Promise<WriteResult> {
    await wait();
    const person = STAFF.find((item) => item.id === userId);
    if (!person) return { value: null, error: "No such user", status: 404, warnings: [] };
    const owner = { id: person.id, name: person.name, role: person.role };
    const clashes = findClashes(userId, body, bookingRows);
    // Only an Admin's entry lands approved, so only it can warn.
    if (isAdmin && clashes.length > 0 && !body.confirm_warnings.includes("booking_clash")) {
      return {
        value: null,
        error: "This time off needs the listed warnings confirmed",
        status: 409,
        warnings: clashWarning(clashes.length),
      };
    }
    const row: ExceptionRow = {
      id: `to-new-${rows.length + 1}`,
      staff: owner,
      start_date: body.start_date,
      end_date: body.end_date,
      start_time: body.start_time,
      end_time: body.end_time,
      reason: body.reason,
      status: isAdmin ? "approved" : "pending",
      created_at: NOW_STAMP,
      decided_by: isAdmin ? meRef : null,
      decided_at: isAdmin ? NOW_STAMP : null,
      cancelled_by: null,
      cancelled_at: null,
    };
    setRows((current) => [row, ...current]);
    return { value: readException(row, bookingRows), error: null, status: 201, warnings: [] };
  }

  async function decide(
    id: string,
    status: "approved" | "rejected",
    isConfirmed: boolean,
  ): Promise<WriteResult> {
    await wait();
    const item = timeOff.find((entry) => entry.id === id);
    if (!item) return { value: null, error: "No such time off", status: 404, warnings: [] };
    if (status === "approved" && item.clashing_bookings_count > 0 && !isConfirmed) {
      return {
        value: null,
        error: "This time off needs the listed warnings confirmed",
        status: 409,
        warnings: clashWarning(item.clashing_bookings_count),
      };
    }
    const value = updateRow(id, { status, decided_by: meRef, decided_at: NOW_STAMP });
    return { value, error: null, status: 200, warnings: [] };
  }

  async function cancel(id: string): Promise<Result<ExceptionRead>> {
    await wait();
    const value = updateRow(id, { status: "cancelled", cancelled_by: meRef, cancelled_at: NOW_STAMP });
    return { value, error: value ? null : "No such time off", status: value ? 200 : 404 };
  }

  async function markCompleted(bookingId: string): Promise<Result<BookingDetail>> {
    await wait();
    const booking = bookingRows.find((item) => item.id === bookingId);
    if (!booking || !hasStarted(booking)) {
      return { value: null, error: "A booking can be marked completed only after it has started", status: 422 };
    }
    const next: BookingDetail = { ...booking, status: "completed", updated_at: NOW_STAMP };
    setBookingRows((current) => current.map((item) => (item.id === bookingId ? next : item)));
    return { value: next, error: null, status: 200 };
  }

  async function saveAvailability(next: AvailabilitySlot[]): Promise<Result<number>> {
    // Optimistic: the kit editor leaves edit mode on Save and has no
    // saving state, so the week shows the new times straight away.
    const calls = diffWeek(slots, next);
    setSlots(toWireRows(me.tutor_id ?? "", next));
    await wait();
    return { value: calls.length, error: null, status: 200 };
  }

  return {
    me,
    staff: STAFF,
    bookings,
    timeOff,
    availability: slots,
    counts,
    createTimeOff,
    decide,
    cancel,
    markCompleted,
    saveAvailability,
  };
}
