// The prototype's whole in-memory backend: one Database in state, plus
// the writes the screens make (each named after the endpoint it stands
// in for). Shared through context so details panels can write too.
import { createContext, useContext, useState } from "react";
import {
  createDatabase,
  createEmptyDatabase,
  NOW_ISO,
  SUBJECTS,
} from "@/pages/prototype/accounts-staff/lib/mock-data";
import type {
  ChildRow,
  Database,
  GuardianRow,
  HomeRow,
  StaffRow,
} from "@/pages/prototype/accounts-staff/lib/mock-data";
import { countUpcomingAtHome } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type {
  AvailabilityRead,
  ClientHomeCreate,
  ExceptionRead,
  NamedRef,
  TutorSubjectRead,
  UserRole,
} from "@/pages/prototype/accounts-staff/types/api";

export type NewStaff = {
  role: UserRole;
  name: string;
  email: string;
  phone_number: string;
  shouldInvite: boolean;
};

// ClientCreate (a Guardian, optionally with a first Home), then, inside a
// family, POST /api/children/{id}/guardians per Child (GuardianLinkCreate,
// whose home_ids also share existing Homes with the new Guardian).
export type NewGuardian = {
  name: string;
  phone_number: string;
  home: ClientHomeCreate | null;
  child_ids: string[];
  shared_home_ids: string[];
};

// ChildCreate
export type NewChild = {
  guardian_ids: string[];
  name: string;
  date_of_birth: string;
  grade_level: number | null;
  school_name: string;
  notes: string | null;
};

export type NewTimeOff = {
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
};

export type EvaluationInput = {
  levels: { subject_id: string; level: number }[];
  staff_ids: string[];
};

export type AreaStore = {
  db: Database;
  actor: NamedRef;
  updateChild: (id: string, patch: Partial<ChildRow>) => void;
  setChildArchived: (id: string, isArchived: boolean) => number;
  setEvaluated: (id: string, isEvaluated: boolean) => void;
  setLevel: (childId: string, subjectId: string, level: number | null) => void;
  // PROPOSED PUT /api/children/{id}/assigned-tutors {staff_ids}.
  setAssignedTutors: (childId: string, staffIds: string[]) => void;
  // PROPOSED PUT /api/staff/{id}/children {child_ids}: the same links,
  // written from the Staff member's side.
  setAssignedChildren: (staffId: string, childIds: string[]) => void;
  // PROPOSED POST /api/children/{id}/evaluated {levels, staff_ids}: one
  // write for the levels, the mark and the first Assigned Tutors.
  // Returns the Child as it was, for Undo.
  markEvaluated: (childId: string, input: EvaluationInput) => ChildRow | null;
  addGuardian: (input: NewGuardian) => string;
  addChild: (input: NewChild) => string;
  updateGuardian: (id: string, patch: Partial<GuardianRow>) => void;
  setGuardianArchived: (id: string, isArchived: boolean) => void;
  // One Home saved on one or more Guardians.
  addHome: (guardianIds: string[], home: ClientHomeCreate) => void;
  updateHome: (id: string, patch: Partial<HomeRow>) => void;
  // false: the API's 409, the Home still has upcoming Bookings.
  setHomeArchived: (id: string, isArchived: boolean) => boolean;
  addStaff: (input: NewStaff) => string;
  updateStaff: (id: string, patch: Partial<StaffRow>) => void;
  setStaffArchived: (id: string, isArchived: boolean) => void;
  sendInvite: (id: string) => void;
  setSubjects: (id: string, subjects: TutorSubjectRead[]) => void;
  setAvailability: (tutorId: string, slots: AvailabilityRead[]) => void;
  addTimeOff: (staffId: string, input: NewTimeOff) => void;
  decideTimeOff: (id: string, status: "approved" | "rejected") => void;
  cancelTimeOff: (id: string) => void;
};

export const AreaStoreContext = createContext<AreaStore | null>(null);

export function useArea(): AreaStore {
  const store = useContext(AreaStoreContext);
  if (!store) throw new Error("useArea needs an AreaStoreContext provider");
  return store;
}

const INVITE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function nextId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

function replaceById<T extends { id: string }>(
  rows: T[],
  id: string,
  patch: Partial<T>,
): T[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

function removeAssignments(children: ChildRow[], staffId: string): ChildRow[] {
  return children.map((child) =>
    child.assigned_tutor_ids.includes(staffId)
      ? { ...child, assigned_tutor_ids: child.assigned_tutor_ids.filter((id) => id !== staffId) }
      : child,
  );
}

export const SETUP_STAFF_ID = "u-rafael";

// The "just added" Tutor the setup-checklist screen starts on: invited,
// with no Subjects and no Availability yet.
function addJustAddedTutor(db: Database): Database {
  const row: StaffRow = {
    id: SETUP_STAFF_ID,
    name: "Rafael Soto",
    role: "tutor",
    tutor_id: "t-rafael",
    email: "rafael.soto@gmail.com",
    phone_number: "+17865550190",
    bio: null,
    sign_in_state: "invited",
    invite_expires_at: "2026-10-20T08:40:00-04:00",
    archived: false,
    subjects: [],
  };
  return { ...db, staff: [...db.staff, row] };
}

type StoreOptions = { isEmpty: boolean; hasJustAddedTutor: boolean };

export function useAreaStoreState(
  { isEmpty, hasJustAddedTutor }: StoreOptions,
  actor: NamedRef,
): AreaStore {
  const [db, setDb] = useState<Database>(() => {
    const base = isEmpty ? createEmptyDatabase() : createDatabase();
    return hasJustAddedTutor ? addJustAddedTutor(base) : base;
  });

  function patch(update: (current: Database) => Partial<Database>): void {
    setDb((current) => ({ ...current, ...update(current) }));
  }

  // Archiving a Child cancels its upcoming Bookings (CONTEXT: Archive).
  function setChildArchived(id: string, isArchived: boolean): number {
    const cancelled = isArchived
      ? db.bookings.filter(
          (booking) =>
            booking.child.id === id &&
            (booking.status === "pending" || booking.status === "confirmed") &&
            booking.scheduled_date >= NOW_ISO.slice(0, 10),
        )
      : [];
    const cancelledIds = new Set(cancelled.map((booking) => booking.id));
    patch((current) => ({
      children: replaceById(current.children, id, { archived: isArchived }),
      bookings: current.bookings.map((booking) =>
        cancelledIds.has(booking.id)
          ? { ...booking, status: "cancelled" as const }
          : booking,
      ),
    }));
    return cancelled.length;
  }

  function setLevel(childId: string, subjectId: string, level: number | null): void {
    const subject = SUBJECTS.find((item) => item.id === subjectId);
    if (!subject) return;
    patch((current) => ({
      children: current.children.map((child) => {
        if (child.id !== childId) return child;
        const others = child.levels.filter((item) => item.subject_id !== subjectId);
        const levels =
          level === null
            ? others
            : [
                ...others,
                {
                  subject_id: subject.id,
                  name: subject.name,
                  archived: false,
                  level,
                  set_by: actor,
                  updated_at: NOW_ISO,
                },
              ];
        return { ...child, levels };
      }),
    }));
  }

  function setAssignedChildren(staffId: string, childIds: string[]): void {
    patch((current) => ({
      children: current.children.map((child) => {
        const isLinked = child.assigned_tutor_ids.includes(staffId);
        const shouldLink = childIds.includes(child.id);
        if (isLinked === shouldLink) return child;
        return {
          ...child,
          assigned_tutor_ids: shouldLink
            ? [...child.assigned_tutor_ids, staffId]
            : child.assigned_tutor_ids.filter((id) => id !== staffId),
        };
      }),
    }));
  }

  function markEvaluated(childId: string, input: EvaluationInput): ChildRow | null {
    const before = db.children.find((child) => child.id === childId) ?? null;
    if (!before) return null;
    const levels = input.levels.flatMap((item) => {
      const subject = SUBJECTS.find((entry) => entry.id === item.subject_id);
      if (!subject) return [];
      const existing = before.levels.find((entry) => entry.subject_id === subject.id);
      // An unchanged level keeps who set it.
      if (existing?.level === item.level) return [existing];
      return [{ subject_id: subject.id, name: subject.name, archived: false, level: item.level, set_by: actor, updated_at: NOW_ISO }];
    });
    patch((current) => ({
      children: replaceById(current.children, childId, {
        levels,
        evaluated: { at: NOW_ISO, by: actor },
        assigned_tutor_ids: input.staff_ids,
      }),
    }));
    return before;
  }

  function setHomeArchived(id: string, isArchived: boolean): boolean {
    if (isArchived && countUpcomingAtHome(db, id) > 0) return false;
    patch((current) => ({
      homes: replaceById(current.homes, id, { archived: isArchived }),
    }));
    return true;
  }

  function addStaff(input: NewStaff): string {
    const id = nextId("u");
    const hasProfile = input.role !== "admin";
    const row: StaffRow = {
      id,
      name: input.name,
      role: input.role,
      tutor_id: hasProfile ? nextId("t") : null,
      email: input.email,
      phone_number: input.phone_number,
      bio: null,
      sign_in_state: input.shouldInvite ? "invited" : "not_invited",
      invite_expires_at: input.shouldInvite
        ? new Date(Date.parse(NOW_ISO) + INVITE_DAYS * DAY_MS).toISOString()
        : null,
      archived: false,
      subjects: [],
    };
    patch((current) => ({ staff: [...current.staff, row] }));
    return id;
  }

  function sendInvite(id: string): void {
    patch((current) => ({
      staff: replaceById(current.staff, id, {
        sign_in_state: "invited",
        invite_expires_at: new Date(
          Date.parse(NOW_ISO) + INVITE_DAYS * DAY_MS,
        ).toISOString(),
      }),
    }));
  }

  function setAvailability(tutorId: string, slots: AvailabilityRead[]): void {
    patch((current) => ({
      availability: [
        ...current.availability.filter((slot) => slot.tutor_id !== tutorId),
        ...slots,
      ],
    }));
  }

  // Time off an Admin enters takes effect straight away (approved).
  function addTimeOff(staffId: string, input: NewTimeOff): void {
    const staff = db.staff.find((row) => row.id === staffId);
    if (!staff) return;
    const item: ExceptionRead = {
      id: nextId("to"),
      staff: { id: staff.id, name: staff.name, role: staff.role },
      ...input,
      status: "approved",
      created_at: NOW_ISO,
      decided_by: actor,
      decided_at: NOW_ISO,
      cancelled_by: null,
      cancelled_at: null,
      clashing_bookings: [],
      clashing_bookings_count: 0,
    };
    patch((current) => ({ timeOff: [item, ...current.timeOff] }));
  }

  function addGuardian(input: NewGuardian): string {
    const id = nextId("g");
    const guardian: GuardianRow = {
      id,
      name: input.name,
      phone_number: input.phone_number,
      archived: false,
      language: null,
      language_conversation_id: null,
      reminders: "never",
      reminders_blocked_by_whatsapp: false,
    };
    const homes: HomeRow[] = input.home
      ? [{ id: nextId("h"), ...input.home, archived: false, guardian_ids: [id] }]
      : [];
    patch((current) => ({
      guardians: [...current.guardians, guardian],
      homes: [
        ...current.homes.map((home) =>
          input.shared_home_ids.includes(home.id)
            ? { ...home, guardian_ids: [...home.guardian_ids, id] }
            : home,
        ),
        ...homes,
      ],
      children: current.children.map((child) =>
        input.child_ids.includes(child.id)
          ? { ...child, guardian_ids: [...child.guardian_ids, id] }
          : child,
      ),
    }));
    return id;
  }

  function addChild(input: NewChild): string {
    const id = nextId("c");
    const child: ChildRow = {
      id,
      ...input,
      archived: false,
      levels: [],
      evaluated: null,
      created_at: NOW_ISO,
      assigned_tutor_ids: [],
    };
    patch((current) => ({ children: [...current.children, child] }));
    return id;
  }

  return {
    db,
    actor,
    addGuardian,
    addChild,
    updateChild: (id, changes) =>
      patch((current) => ({
        children: replaceById(current.children, id, changes),
      })),
    setChildArchived,
    setEvaluated: (id, isEvaluated) =>
      patch((current) => ({
        children: replaceById(current.children, id, {
          evaluated: isEvaluated ? { at: NOW_ISO, by: actor } : null,
        }),
      })),
    setLevel,
    setAssignedTutors: (childId, staffIds) =>
      patch((current) => ({
        children: replaceById(current.children, childId, { assigned_tutor_ids: staffIds }),
      })),
    setAssignedChildren,
    markEvaluated,
    updateGuardian: (id, changes) =>
      patch((current) => ({
        guardians: replaceById(current.guardians, id, changes),
      })),
    setGuardianArchived: (id, isArchived) =>
      patch((current) => ({
        guardians: replaceById(current.guardians, id, { archived: isArchived }),
      })),
    addHome: (guardianIds, home) =>
      patch((current) => ({
        homes: [
          ...current.homes,
          { id: nextId("h"), ...home, archived: false, guardian_ids: guardianIds },
        ],
      })),
    updateHome: (id, changes) =>
      patch((current) => ({ homes: replaceById(current.homes, id, changes) })),
    setHomeArchived,
    addStaff,
    // Becoming an Admin also removes their Assigned Tutor links.
    updateStaff: (id, changes) =>
      patch((current) => ({
        staff: replaceById(current.staff, id, changes),
        children: changes.role === "admin" ? removeAssignments(current.children, id) : current.children,
      })),
    // Archiving removes their Assigned Tutor links; Restore doesn't bring
    // them back (Franklin, 2026-10-15).
    setStaffArchived: (id, isArchived) =>
      patch((current) => ({
        staff: replaceById(current.staff, id, { archived: isArchived }),
        children: isArchived ? removeAssignments(current.children, id) : current.children,
      })),
    sendInvite,
    setSubjects: (id, subjects) =>
      patch((current) => ({ staff: replaceById(current.staff, id, { subjects }) })),
    setAvailability,
    addTimeOff,
    decideTimeOff: (id, status) =>
      patch((current) => ({
        timeOff: replaceById(current.timeOff, id, {
          status,
          decided_by: actor,
          decided_at: NOW_ISO,
        }),
      })),
    cancelTimeOff: (id) =>
      patch((current) => ({
        timeOff: replaceById(current.timeOff, id, {
          status: "cancelled",
          cancelled_by: actor,
          cancelled_at: NOW_ISO,
        }),
      })),
  };
}
