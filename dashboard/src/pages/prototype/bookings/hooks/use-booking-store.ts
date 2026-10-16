// The prototype's "server": Bookings in memory, with each write shaped
// like its endpoint. sort_out_reasons are recomputed on every read, as
// the API computes them on read.
import { useMemo, useState } from "react";
import {
  getChildNotes,
  getGuardiansOf,
  getHomeRef,
  SEED_BOOKINGS,
  STAFF,
  SUBJECTS,
  CHILDREN,
} from "@/pages/prototype/bookings/lib/mock-data";
import { getSortOutReasons } from "@/pages/prototype/bookings/lib/rules";
import type {
  BookingCreate,
  BookingDetail,
  BookingStatus,
  NamedRef,
} from "@/pages/prototype/bookings/lib/wire";

const FAKE_NOW_ISO = "2026-10-13T08:40:00";

export type BookingStore = {
  bookings: BookingDetail[];
  getBooking: (id: string) => BookingDetail | null;
  // PATCH /api/bookings/{id} {status}
  setStatus: (id: string, status: BookingStatus) => void;
  // POST / DELETE /api/bookings/{id}/clash-acknowledgement
  acknowledgeClash: (id: string, by: NamedRef) => void;
  withdrawAcknowledgement: (id: string) => void;
  // POST /api/bookings, PUT /api/bookings/{id}
  create: (body: BookingCreate) => BookingDetail;
  replace: (id: string, body: BookingCreate) => BookingDetail;
};

function buildDetail(
  id: string,
  body: BookingCreate,
  previous: BookingDetail | null,
): BookingDetail {
  const staff = STAFF.find((item) => item.id === body.user_id) ?? STAFF[0];
  const child = CHILDREN.find((item) => item.id === body.child_id) ?? CHILDREN[0];
  const subject = SUBJECTS.find((item) => item.id === body.subject_id) ?? null;
  const level = child.levels.find((item) => item.subject_id === subject?.id);
  // A changed Staff member, date or time is a new situation: a kept
  // clash no longer applies (placeholder; the API decides this).
  const isSameSlot =
    previous?.staff.id === body.user_id &&
    previous.scheduled_date === body.scheduled_date &&
    previous.start_time === body.start_time;
  return {
    id,
    child: { id: child.id, name: child.name, notes: getChildNotes(child.id) },
    staff: { id: staff.id, name: staff.name, role: staff.role },
    kind: body.kind,
    location: body.location,
    subject,
    subject_level: level?.level ?? null,
    scheduled_date: body.scheduled_date,
    start_time: body.start_time,
    end_time: body.end_time,
    status: previous?.status ?? "confirmed",
    notes: body.notes,
    home: body.home_id ? getHomeRef(body.home_id) : null,
    booked_by_guardian: previous?.booked_by_guardian ?? null,
    guardians: getGuardiansOf(child.id),
    sort_out_reasons: [],
    clash_acknowledged_by: isSameSlot ? previous.clash_acknowledged_by : null,
    clash_acknowledged_at: isSameSlot ? previous.clash_acknowledged_at : null,
    updated_at: FAKE_NOW_ISO,
  };
}

export function useBookingStore(): BookingStore {
  const [rows, setRows] = useState<BookingDetail[]>(SEED_BOOKINGS);
  const [nextId, setNextId] = useState(100);

  const bookings = useMemo(
    () =>
      rows.map((row) => ({ ...row, sort_out_reasons: getSortOutReasons(row) })),
    [rows],
  );

  function update(id: string, change: Partial<BookingDetail>): void {
    setRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, ...change, updated_at: FAKE_NOW_ISO } : row,
      ),
    );
  }

  function getBooking(id: string): BookingDetail | null {
    return bookings.find((booking) => booking.id === id) ?? null;
  }

  function create(body: BookingCreate): BookingDetail {
    const detail = buildDetail(`bk-new-${nextId}`, body, null);
    setNextId(nextId + 1);
    setRows((current) => [...current, detail]);
    return { ...detail, sort_out_reasons: getSortOutReasons(detail) };
  }

  function replace(id: string, body: BookingCreate): BookingDetail {
    const previous = rows.find((row) => row.id === id) ?? null;
    const detail = buildDetail(id, body, previous);
    setRows((current) => current.map((row) => (row.id === id ? detail : row)));
    return { ...detail, sort_out_reasons: getSortOutReasons(detail) };
  }

  return {
    bookings,
    getBooking,
    setStatus: (id, status) => update(id, { status }),
    acknowledgeClash: (id, by) =>
      update(id, { clash_acknowledged_by: by, clash_acknowledged_at: FAKE_NOW_ISO }),
    withdrawAcknowledgement: (id) =>
      update(id, { clash_acknowledged_by: null, clash_acknowledged_at: null }),
    create,
    replace,
  };
}
