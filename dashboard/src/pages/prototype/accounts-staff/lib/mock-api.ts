// Reads that turn the mock rows into the API's wire shapes, one
// function per endpoint the screens would call.
import type {
  Database,
  HomeRow,
} from "@/pages/prototype/accounts-staff/lib/mock-data";
import { TODAY } from "@/pages/prototype/accounts-staff/lib/mock-data";
import type {
  AssignedChildRead,
  AssignedTutorRef,
  AvailabilityRead,
  BookingSummary,
  ChildDetail,
  ChildHomeRead,
  ChildLevelRead,
  ChildLevelRef,
  ChildSummary,
  ClientRead,
  ClientSummary,
  CountsRead,
  ExceptionRead,
  HomeRead,
  HouseholdRead,
  NamedRef,
  NextSession,
  StaffRead,
  StaffRef,
  TutorRead,
} from "@/pages/prototype/accounts-staff/types/api";

const LIVE_STATUSES = new Set(["pending", "confirmed"]);
const WEEK_END = "2026-10-18";

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

function getGuardianRefs(db: Database, ids: string[]): NamedRef[] {
  return db.guardians
    .filter((guardian) => ids.includes(guardian.id))
    .map((guardian) => ({ id: guardian.id, name: guardian.name }))
    .sort(byName);
}

function toHomeRead(db: Database, home: HomeRow): HomeRead {
  return {
    id: home.id,
    label: home.label,
    address: home.address,
    directions: home.directions,
    archived: home.archived,
    guardians: getGuardianRefs(db, home.guardian_ids),
  };
}

// A Child's Homes are every Home of every one of its Guardians.
function getChildHomes(db: Database, guardianIds: string[]): ChildHomeRead[] {
  return db.homes
    .filter((home) => home.guardian_ids.some((id) => guardianIds.includes(id)))
    .map((home) => toHomeRead(db, home));
}

function isUpcomingLive(booking: BookingSummary): boolean {
  return (
    LIVE_STATUSES.has(booking.status) && booking.scheduled_date >= TODAY
  );
}

function sortByStart(a: BookingSummary, b: BookingSummary): number {
  return (
    a.scheduled_date.localeCompare(b.scheduled_date) ||
    a.start_time.localeCompare(b.start_time)
  );
}

export function getUpcomingBookings(
  db: Database,
  match: (booking: BookingSummary) => boolean,
): BookingSummary[] {
  return db.bookings
    .filter((booking) => isUpcomingLive(booking) && match(booking))
    .sort(sortByStart);
}

function toNextSession(booking: BookingSummary | undefined): NextSession | null {
  if (!booking) return null;
  return {
    id: booking.id,
    scheduled_date: booking.scheduled_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    tutor: { id: booking.staff.id, name: booking.staff.name },
    subject: booking.subject,
  };
}

// PROPOSED: a Child's Assigned Tutors.
function getAssignedTutors(db: Database, ids: string[]): AssignedTutorRef[] {
  return db.staff
    .filter((row) => ids.includes(row.id))
    .map((row) => ({ id: row.id, name: row.name, role: row.role }))
    .sort(byName);
}

// PROPOSED: who ran the latest Evaluation session that wasn't cancelled
// and whose day has come.
function getEvaluationRunner(db: Database, childId: string): StaffRef | null {
  const held = db.bookings
    .filter(
      (booking) =>
        booking.child.id === childId &&
        booking.kind === "evaluation" &&
        booking.status !== "cancelled" &&
        booking.scheduled_date <= TODAY,
    )
    .sort(sortByStart);
  return held[held.length - 1]?.staff ?? null;
}

// PROPOSED: GET /api/staff/{id}/children. Evaluated Children only: a
// Child whose Evaluated mark was cleared keeps its links, hidden here.
export function listAssignedChildren(db: Database, staffId: string): AssignedChildRead[] {
  return db.children
    .filter((child) => child.evaluated !== null && child.assigned_tutor_ids.includes(staffId))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || byName(a, b))
    .map((child) => ({
      id: child.id,
      name: child.name,
      archived: child.archived,
      guardians: getGuardianRefs(db, child.guardian_ids),
      levels: getLevelRefs(child.levels),
      assigned_tutors: getAssignedTutors(db, child.assigned_tutor_ids),
    }));
}

function getLevelRefs(levels: ChildLevelRead[]): ChildLevelRef[] {
  return levels
    .filter((item) => !item.archived)
    .map(({ subject_id, name, level }) => ({ subject_id, name, level }))
    .sort(byName);
}

// GET /api/children?archived=
export function listChildren(db: Database, isArchived: boolean): ChildSummary[] {
  return db.children
    .filter((child) => child.archived === isArchived)
    .sort(byName)
    .map((child) => {
      const upcoming = getUpcomingBookings(db, (b) => b.child.id === child.id);
      return {
        id: child.id,
        name: child.name,
        grade_level: child.grade_level,
        school_name: child.school_name,
        archived: child.archived,
        guardians: getGuardianRefs(db, child.guardian_ids),
        homes: getChildHomes(db, child.guardian_ids).map((home) => ({
          id: home.id,
          label: home.label,
          address: home.address,
          archived: home.archived,
          guardians: home.guardians,
        })),
        next_session: toNextSession(upcoming[0]),
        levels: getLevelRefs(child.levels),
        evaluated: child.evaluated,
        created_at: child.created_at,
        assigned_tutors: getAssignedTutors(db, child.assigned_tutor_ids),
      };
    });
}

// GET /api/children/{id}
export function readChild(db: Database, id: string): ChildDetail | null {
  const child = db.children.find((row) => row.id === id);
  if (!child) return null;
  const upcoming = getUpcomingBookings(db, (b) => b.child.id === child.id);
  return {
    id: child.id,
    name: child.name,
    date_of_birth: child.date_of_birth,
    grade_level: child.grade_level,
    school_name: child.school_name,
    notes: child.notes,
    archived: child.archived,
    upcoming_session_count: upcoming.length,
    next_session: toNextSession(upcoming[0]),
    guardians: db.guardians
      .filter((guardian) => child.guardian_ids.includes(guardian.id))
      .sort(byName)
      .map((guardian) => ({
        id: guardian.id,
        name: guardian.name,
        phone_number: guardian.phone_number,
        archived: guardian.archived,
        language: guardian.language ?? "en",
        reminders: guardian.reminders,
        reminders_blocked_by_whatsapp: guardian.reminders_blocked_by_whatsapp,
      })),
    homes: getChildHomes(db, child.guardian_ids),
    levels: [...child.levels].sort(byName),
    evaluated: child.evaluated,
    assigned_tutors: getAssignedTutors(db, child.assigned_tutor_ids),
    evaluation_run_by: getEvaluationRunner(db, child.id),
  };
}

// GET /api/clients?archived=
export function listClients(db: Database, isArchived: boolean): ClientSummary[] {
  return db.guardians
    .filter((guardian) => guardian.archived === isArchived)
    .sort(byName)
    .map((guardian) => {
      const children = db.children
        .filter((child) => !child.archived && child.guardian_ids.includes(guardian.id))
        .map((child) => ({ id: child.id, name: child.name }))
        .sort(byName);
      return {
        id: guardian.id,
        name: guardian.name,
        phone_number: guardian.phone_number,
        archived: guardian.archived,
        home_count: db.homes.filter(
          (home) => !home.archived && home.guardian_ids.includes(guardian.id),
        ).length,
        child_count: children.length,
        language: guardian.language ?? "en",
        reminders: guardian.reminders,
        reminders_blocked_by_whatsapp: guardian.reminders_blocked_by_whatsapp,
        children,
      };
    });
}

// GET /api/clients/{id}
export function readClient(db: Database, id: string): ClientRead | null {
  const guardian = db.guardians.find((row) => row.id === id);
  if (!guardian) return null;
  return {
    id: guardian.id,
    name: guardian.name,
    phone_number: guardian.phone_number,
    archived: guardian.archived,
    homes: db.homes
      .filter((home) => home.guardian_ids.includes(guardian.id))
      .map((home) => toHomeRead(db, home)),
    children: db.children
      .filter((child) => child.guardian_ids.includes(guardian.id))
      .sort(byName)
      .map((child) => ({
        id: child.id,
        name: child.name,
        date_of_birth: child.date_of_birth,
        grade_level: child.grade_level,
        school_name: child.school_name,
        notes: child.notes,
        archived: child.archived,
        evaluated: child.evaluated,
      })),
    language: guardian.language,
    language_conversation_id: guardian.language_conversation_id,
  };
}

// Not on the wire: HomeRead has no upcoming count, so the dashboard only
// learns of these Bookings from the archive call's 409 (see report).
export function countUpcomingAtHome(db: Database, homeId: string): number {
  return getUpcomingBookings(db, (b) => b.home?.id === homeId).length;
}

// GET /api/staff?archived=   Developers never appear.
export function listStaff(db: Database, isArchived: boolean): StaffRead[] {
  return db.staff
    .filter((row) => row.archived === isArchived && row.role !== "developer")
    .sort(byName)
    .map((row) => readStaffRow(db, row.id))
    .filter((row): row is StaffRead => row !== null);
}

function readStaffRow(db: Database, id: string): StaffRead | null {
  const row = db.staff.find((item) => item.id === id);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    tutor_id: row.tutor_id,
    email: row.email,
    sign_in_state: row.sign_in_state,
    invite_expires_at: row.invite_expires_at,
    archived: row.archived,
    subjects: row.subjects
      .map((subject) => ({ id: subject.subject_id, name: subject.name }))
      .sort(byName),
    sessions_this_week: db.bookings.filter(
      (booking) =>
        booking.staff.id === row.id &&
        booking.status !== "cancelled" &&
        booking.scheduled_date >= TODAY &&
        booking.scheduled_date <= WEEK_END,
    ).length,
  };
}

// GET /api/staff/{id}
export function readStaff(db: Database, id: string): StaffRead | null {
  return readStaffRow(db, id);
}

// GET /api/tutors/{tutor_id}: phone, bio and Subject ceilings.
export function readTutor(db: Database, staffId: string): TutorRead | null {
  const row = db.staff.find((item) => item.id === staffId);
  if (!row?.tutor_id) return null;
  return {
    id: row.tutor_id,
    user_id: row.id,
    name: row.name,
    email: row.email,
    phone_number: row.phone_number,
    bio: row.bio,
    archived: row.archived,
    subjects: [...row.subjects].sort(byName),
  };
}

// GET /api/tutors/{tutor_id}/availability
export function listAvailability(db: Database, tutorId: string): AvailabilityRead[] {
  return db.availability.filter(
    (slot) => slot.tutor_id === tutorId && slot.is_active,
  );
}

// GET /api/users/{id}/exceptions, upcoming first then history.
export function listTimeOff(db: Database, userId: string): ExceptionRead[] {
  return db.timeOff
    .filter((item) => item.staff.id === userId)
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
}

export function isTimeOffUpcoming(item: ExceptionRead): boolean {
  return item.end_date >= TODAY;
}

export function hasPendingTimeOff(db: Database, userId: string): boolean {
  return db.timeOff.some(
    (item) => item.staff.id === userId && item.status === "pending",
  );
}

// GET /api/counts. A Manager's time_off_pending is null by contract.
export function readCounts(db: Database, isAdmin: boolean): CountsRead {
  return {
    needs_attention: 3,
    time_off_pending: isAdmin
      ? db.timeOff.filter((item) => item.status === "pending").length
      : null,
    children_awaiting_evaluation: db.children.filter(
      (child) => !child.archived && !child.evaluated,
    ).length,
    children_needing_tutor: 0,
    bookings_to_sort_out: 2,
    unread_chats: 2,
  };
}

function findRoot(parent: Map<string, string>, id: string): string {
  let root = id;
  while (parent.get(root) !== root) root = parent.get(root) ?? root;
  return root;
}

function matchesHousehold(household: HouseholdRead, query: string): boolean {
  const needle = query.trim().toLowerCase();
  const digits = needle.replace(/[^\d]/g, "");
  const members = [...household.guardians, ...household.children];
  return (
    !needle ||
    members.some((member) => member.name.toLowerCase().includes(needle)) ||
    (digits.length > 0 &&
      household.guardians.some((guardian) => guardian.phone_number.includes(digits)))
  );
}

// GET /api/households?q=: Guardians joined through shared Children (a
// union-find over child_guardians, as household_service does). Homes
// play no part, and a Guardian with no Children is a household alone.
export function listHouseholds(db: Database, query = ""): HouseholdRead[] {
  const parent = new Map(db.guardians.map((guardian) => [guardian.id, guardian.id]));
  for (const child of db.children) {
    const [first, ...rest] = child.guardian_ids;
    for (const other of rest) {
      parent.set(findRoot(parent, first), findRoot(parent, other));
    }
  }
  const groups = new Map<string, HouseholdRead>();
  for (const guardian of [...db.guardians].sort(byName)) {
    const root = findRoot(parent, guardian.id);
    const group = groups.get(root) ?? { key: guardian.id, guardians: [], children: [] };
    group.guardians.push({
      id: guardian.id,
      name: guardian.name,
      phone_number: guardian.phone_number,
      archived: guardian.archived,
    });
    groups.set(root, group);
  }
  for (const child of [...db.children].sort(byName)) {
    const ref = {
      id: child.id,
      name: child.name,
      grade_level: child.grade_level,
      archived: child.archived,
    };
    const first = child.guardian_ids[0];
    if (first) {
      groups.get(findRoot(parent, first))?.children.push(ref);
    } else {
      // Not possible on the API today (ChildCreate needs a Guardian):
      // a Child added alone is a family of its own (see report).
      groups.set(child.id, { key: child.id, guardians: [], children: [ref] });
    }
  }
  return [...groups.values()]
    .filter((household) => matchesHousehold(household, query))
    .sort((a, b) => getLeadName(a).localeCompare(getLeadName(b)));
}

function getLeadName(household: HouseholdRead): string {
  return household.guardians[0]?.name ?? household.children[0]?.name ?? "";
}

// No family endpoint: the dashboard finds the household holding a
// Guardian or Child in the list.
export function findHousehold(db: Database, memberId: string): HouseholdRead | null {
  return (
    listHouseholds(db).find((household) =>
      [...household.guardians, ...household.children].some(
        (member) => member.id === memberId,
      ),
    ) ?? null
  );
}

// GET /api/clients/{id}/bookings?from=&to= per Guardian, merged and
// de-duplicated: every Booking of the Children in that date range.
export function listFamilyBookings(
  db: Database,
  childIds: string[],
  from: string,
  to: string,
): BookingSummary[] {
  return db.bookings
    .filter(
      (booking) =>
        childIds.includes(booking.child.id) &&
        booking.scheduled_date >= from &&
        booking.scheduled_date <= to,
    )
    .sort(sortByStart);
}

export function readBooking(db: Database, id: string): BookingSummary | null {
  return db.bookings.find((booking) => booking.id === id) ?? null;
}

// The Homes of a household's Guardians, each once, archived last.
export function listHouseholdHomes(db: Database, household: HouseholdRead): HomeRead[] {
  const ids = household.guardians.map((guardian) => guardian.id);
  return db.homes
    .filter((home) => home.guardian_ids.some((id) => ids.includes(id)))
    .map((home) => toHomeRead(db, home))
    .sort((a, b) => Number(a.archived) - Number(b.archived));
}
