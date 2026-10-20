// In-memory responses for the four reads Home makes, shaped exactly as
// the API returns them (see ../types/api.ts). Prototype only.
//   GET /api/counts
//   GET /api/conversations?flagged=true            (Chats card, both roles)
//   GET /api/exceptions?status=pending&sort=start  (Time off card, Admin)
//   GET /api/bookings?to_sort_out=true             (Bookings card, Admin)
//   GET /api/children?evaluable=true               (Bookings card, both)
//   GET /api/children?needs_tutor=true  PROPOSED   (Bookings card, both)
//   GET /api/bookings?from=TODAY&to=TODAY&status=confirmed&status=completed
//       (+ &user_id=<me> for a Manager's My sessions today)
import type { Role } from "@/pages/prototype/shared/mock-data";
import type {
  AssignableStaff,
  BookingPage,
  BookingSummary,
  ChildSummary,
  ConversationSummary,
  CountsRead,
  ExceptionRead,
  Page,
  SortOutReason,
  StaffRef,
} from "@/pages/prototype/home/types/api";

// The business clock for the prototype: a Tuesday early afternoon in
// Doral, so today's list has some past rows to dim.
export const TODAY = "2026-10-13";
export const NOW = "2026-10-13T13:10:00-04:00";

const PAGE_SIZE = 20;

const MARIA: StaffRef = { id: "u-maria", name: "Maria Lopez", role: "admin" };
const DANIELA: StaffRef = { id: "u-daniela", name: "Daniela Cruz", role: "manager" };
const MARCO: StaffRef = { id: "u-marco", name: "Marco Diaz", role: "tutor" };
const PRIYA: StaffRef = { id: "u-priya", name: "Priya Patel", role: "tutor" };
const ANA: StaffRef = { id: "u-ana", name: "Ana Ruiz", role: "tutor" };
const JORGE: StaffRef = { id: "u-jorge", name: "Jorge Mena", role: "manager" };

export const CURRENT_STAFF: Record<"admin" | "manager", StaffRef> = {
  admin: MARIA,
  manager: DANIELA,
};

function toPage<T>(items: T[]): Page<T> {
  return { items, total: items.length, page: 1, page_size: PAGE_SIZE };
}

// The API orders the Needs attention queue by `flagged_at` ascending; it
// is not on the list shape, so this array is simply in that order.
const NEEDS_ATTENTION: ConversationSummary[] = [
  {
    id: "c-01",
    phone_number: "+13055550142",
    guardian: { id: "g-herrera", name: "Diana Herrera" },
    status: "bot",
    taken_over_by: null,
    last_message_at: "2026-10-12T19:05:00-04:00",
    last_message_preview:
      "Hola, quería saber si Lucas puede empezar matemáticas también los jueves",
    unread: true,
    flag_reason: "booking_request",
    intake_in_progress: false,
  },
  {
    id: "c-02",
    phone_number: "+13055550188",
    guardian: { id: "g-rojas", name: "Carlos Rojas" },
    status: "human",
    taken_over_by: { id: "u-daniela", name: "Daniela Cruz" },
    last_message_at: "2026-10-13T09:42:00-04:00",
    last_message_preview: "Ok perfect, and is the office open on Saturday?",
    unread: false,
    flag_reason: "question",
    intake_in_progress: false,
  },
  {
    id: "c-03",
    phone_number: "+17865550117",
    guardian: null,
    status: "bot",
    taken_over_by: null,
    last_message_at: "2026-10-13T11:58:00-04:00",
    last_message_preview: "asdf 3pm?? the one near dolphin mall",
    unread: true,
    flag_reason: "stuck",
    intake_in_progress: false,
  },
  {
    id: "c-04",
    phone_number: "+13055550173",
    guardian: { id: "g-mendez", name: "Sofia Mendez" },
    status: "bot",
    taken_over_by: null,
    last_message_at: "2026-10-13T12:30:00-04:00",
    last_message_preview:
      "I'm Mateo's dad too, can I get the session reminders on my phone?",
    unread: true,
    flag_reason: "guardian_link_request",
    intake_in_progress: false,
  },
  {
    id: "c-05",
    phone_number: "+13055550109",
    guardian: { id: "g-vargas", name: "Luis Vargas" },
    status: "bot",
    taken_over_by: null,
    last_message_at: "2026-10-13T12:51:00-04:00",
    last_message_preview: "We'd like Emma back for reading this fall",
    unread: true,
    flag_reason: "reactivation_request",
    intake_in_progress: false,
  },
  {
    // The Guardian last wrote 30h ago: the 24h window has closed.
    id: "c-06",
    phone_number: "+17865550164",
    guardian: { id: "g-paz", name: "Gabriela Paz" },
    status: "bot",
    taken_over_by: null,
    last_message_at: "2026-10-12T07:15:00-04:00",
    last_message_preview: "Can someone call me about the evaluation?",
    unread: false,
    flag_reason: "question",
    intake_in_progress: false,
  },
  {
    id: "c-07",
    phone_number: "+13055550131",
    guardian: { id: "g-soto", name: "Andrea Soto" },
    status: "bot",
    taken_over_by: null,
    last_message_at: "2026-10-13T13:02:00-04:00",
    last_message_preview: "No entiendo, ¿qué día dijiste?",
    unread: true,
    flag_reason: "didnt_understand",
    intake_in_progress: false,
  },
];

const PENDING_TIME_OFF: ExceptionRead[] = [
  {
    id: "t-01",
    staff: MARCO,
    start_date: "2026-10-15",
    end_date: "2026-10-16",
    start_time: null,
    end_time: null,
    reason: "Family wedding in Orlando",
    status: "pending",
    created_at: "2026-10-11T18:20:00-04:00",
    decided_by: null,
    decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    clashing_bookings: [
      {
        booking_id: "b-90",
        date: "2026-10-15",
        start_time: "15:00:00",
        end_time: "16:00:00",
        child_name: "Lucas Herrera",
        status: "confirmed",
      },
      {
        booking_id: "b-91",
        date: "2026-10-16",
        start_time: "16:30:00",
        end_time: "17:30:00",
        child_name: "Mateo Mendez",
        status: "confirmed",
      },
    ],
    clashing_bookings_count: 2,
  },
  {
    id: "t-02",
    staff: JORGE,
    start_date: "2026-10-17",
    end_date: "2026-10-17",
    start_time: "14:00:00",
    end_time: "17:00:00",
    reason: "Doctor's appointment",
    status: "pending",
    created_at: "2026-10-12T09:02:00-04:00",
    decided_by: null,
    decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    clashing_bookings: [],
    clashing_bookings_count: 0,
  },
  {
    id: "t-03",
    staff: PRIYA,
    start_date: "2026-10-24",
    end_date: "2026-10-31",
    start_time: null,
    end_time: null,
    reason: null,
    status: "pending",
    created_at: "2026-10-13T07:45:00-04:00",
    decided_by: null,
    decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    clashing_bookings: [
      {
        booking_id: "b-92",
        date: "2026-10-27",
        start_time: "15:30:00",
        end_time: "16:30:00",
        child_name: "Valentina Rojas",
        status: "confirmed",
      },
    ],
    clashing_bookings_count: 1,
  },
  {
    id: "t-04",
    staff: ANA,
    start_date: "2026-11-02",
    end_date: "2026-11-02",
    start_time: null,
    end_time: null,
    reason: "Moving house",
    status: "pending",
    created_at: "2026-10-13T10:12:00-04:00",
    decided_by: null,
    decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    clashing_bookings: [],
    clashing_bookings_count: 0,
  },
];

type BookingSeed = {
  id: string;
  child: string;
  staff: StaffRef;
  kind: BookingSummary["kind"];
  subject: string | null;
  level: number | null;
  start: string;
  end: string;
  status: BookingSummary["status"];
  home: string | null;
  date?: string;
  reasons?: SortOutReason[];
};

function toBooking(seed: BookingSeed): BookingSummary {
  return {
    id: seed.id,
    child: { id: `ch-${seed.id}`, name: seed.child },
    staff: seed.staff,
    kind: seed.kind,
    location: seed.home ? "home" : "office",
    subject: seed.subject ? { id: `s-${seed.subject}`, name: seed.subject } : null,
    subject_level: seed.level,
    scheduled_date: seed.date ?? TODAY,
    start_time: seed.start,
    end_time: seed.end,
    status: seed.status,
    notes: null,
    home: seed.home
      ? { id: `h-${seed.id}`, label: null, address: seed.home }
      : null,
    sort_out_reasons: seed.reasons ?? [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    updated_at: "2026-10-12T21:00:00-04:00",
  };
}

const TODAY_SEEDS: BookingSeed[] = [
  { id: "b-01", child: "Valentina Rojas", staff: PRIYA, kind: "regular", subject: "Math", level: 5, start: "09:30:00", end: "10:30:00", status: "completed", home: null },
  { id: "b-02", child: "Mateo Mendez", staff: DANIELA, kind: "regular", subject: "Reading", level: 3, start: "11:00:00", end: "12:00:00", status: "confirmed", home: "8450 NW 53rd St, Doral, FL 33166" },
  { id: "b-03", child: "Isabella Paz", staff: MARIA, kind: "evaluation", subject: null, level: null, start: "14:00:00", end: "15:30:00", status: "confirmed", home: null },
  { id: "b-04", child: "Lucas Herrera", staff: MARCO, kind: "regular", subject: "Reading", level: 2, start: "15:00:00", end: "16:00:00", status: "confirmed", home: "10301 NW 41st St, Doral, FL 33178" },
  { id: "b-05", child: "Emma Soto", staff: DANIELA, kind: "regular", subject: "Math", level: 4, start: "16:00:00", end: "17:00:00", status: "confirmed", home: null },
  { id: "b-06", child: "Sebastián Vargas", staff: ANA, kind: "regular", subject: "Science", level: 6, start: "16:30:00", end: "17:30:00", status: "confirmed", home: "4800 NW 102nd Ave, Doral, FL 33178" },
  { id: "b-07", child: "Camila Ortiz", staff: DANIELA, kind: "evaluation", subject: null, level: null, start: "18:00:00", end: "19:30:00", status: "confirmed", home: "7900 NW 36th St, Doral, FL 33166" },
];

const TODAY_BOOKINGS: BookingSummary[] = TODAY_SEEDS.map(toBooking);

// An archived Tutor who still has Bookings coming up.
const LUIS: StaffRef = { id: "u-luis", name: "Luis Ortega", role: "tutor" };

// GET /api/bookings?to_sort_out=true. Home re-orders them (see
// sortBookingsTodo in labels.ts).
const SORT_OUT_SEEDS: BookingSeed[] = [
  { id: "s-01", child: "Lucas Herrera", staff: MARCO, kind: "regular", subject: "Reading", level: 2, start: "15:00:00", end: "16:00:00", status: "confirmed", home: "10301 NW 41st St, Doral, FL 33178", date: "2026-10-09", reasons: ["not_completed"] },
  { id: "s-02", child: "Valentina Rojas", staff: PRIYA, kind: "regular", subject: "Math", level: 5, start: "16:30:00", end: "17:30:00", status: "confirmed", home: null, date: "2026-10-12", reasons: ["not_completed"] },
  { id: "s-03", child: "Emma Soto", staff: ANA, kind: "regular", subject: "Math", level: 4, start: "15:30:00", end: "16:30:00", status: "confirmed", home: null, date: "2026-10-14", reasons: ["time_off_clash"] },
  { id: "s-04", child: "Mateo Mendez", staff: LUIS, kind: "regular", subject: "Science", level: 3, start: "17:00:00", end: "18:00:00", status: "confirmed", home: "8450 NW 53rd St, Doral, FL 33166", date: "2026-10-16", reasons: ["archived_staff"] },
];

const SORT_OUT: BookingSummary[] = SORT_OUT_SEEDS.map(toBooking);

// GET /api/children?evaluable=true: oldest `created_at` first.
const EVALUABLE: ChildSummary[] = [
  {
    id: "ch-tomas",
    name: "Tomás Vargas",
    grade_level: 3,
    school_name: "Doral Academy",
    archived: false,
    guardians: [{ id: "g-vargas", name: "Luis Vargas" }],
    homes: [
      {
        id: "h-vargas",
        label: "Home",
        address: "4800 NW 102nd Ave, Doral, FL 33178",
        archived: false,
        guardians: [{ id: "g-vargas", name: "Luis Vargas" }],
      },
    ],
    next_session: null,
    levels: [],
    evaluated: null,
    assigned_tutors: [],
    created_at: "2026-10-06T10:15:00-04:00",
  },
  {
    id: "ch-lucia",
    name: "Lucía Soto",
    grade_level: 6,
    school_name: "Doral Middle School",
    archived: false,
    guardians: [{ id: "g-soto", name: "Andrea Soto" }],
    homes: [],
    next_session: null,
    levels: [],
    evaluated: null,
    assigned_tutors: [],
    created_at: "2026-10-10T16:40:00-04:00",
  },
  {
    id: "ch-diego",
    name: "Diego Mena",
    grade_level: null,
    school_name: "John I. Smith K-8",
    archived: false,
    guardians: [
      { id: "g-mena-1", name: "Rosa Mena" },
      { id: "g-mena-2", name: "Pablo Mena" },
    ],
    homes: [
      {
        id: "h-mena",
        label: null,
        address: "7900 NW 36th St, Doral, FL 33166",
        archived: false,
        guardians: [{ id: "g-mena-1", name: "Rosa Mena" }],
      },
    ],
    next_session: null,
    levels: [],
    evaluated: null,
    assigned_tutors: [],
    created_at: "2026-10-12T19:05:00-04:00",
  },
];

// PROPOSED GET /api/children?needs_tutor=true (TutorLink#242): Evaluated
// Children with no Assigned Tutor. Mateo's only one, Luis, was archived,
// which removed him (his Booking is in To do too); Valentina's last was
// removed by hand. The list doesn't say which.
const NEEDS_TUTOR: ChildSummary[] = [
  {
    id: "ch-mateo",
    name: "Mateo Mendez",
    grade_level: 3,
    school_name: "Doral Academy",
    archived: false,
    guardians: [{ id: "g-mendez", name: "Teresa Mendez" }],
    homes: [
      {
        id: "h-mendez",
        label: null,
        address: "8450 NW 53rd St, Doral, FL 33166",
        archived: false,
        guardians: [{ id: "g-mendez", name: "Teresa Mendez" }],
      },
    ],
    next_session: null,
    levels: [{ subject_id: "sub-science", name: "Science", level: 3 }],
    evaluated: { at: "2026-08-20T15:00:00-04:00", by: DANIELA },
    created_at: "2026-08-02T10:00:00-04:00",
    assigned_tutors: [],
  },
  {
    id: "ch-valentina",
    name: "Valentina Rojas",
    grade_level: 5,
    school_name: "Doral Academy",
    archived: false,
    guardians: [{ id: "g-rojas", name: "Carlos Rojas" }],
    homes: [],
    next_session: null,
    levels: [
      { subject_id: "sub-math", name: "Math", level: 5 },
      { subject_id: "sub-reading", name: "Reading", level: 4 },
    ],
    evaluated: { at: "2026-09-01T10:00:00-04:00", by: MARIA },
    created_at: "2026-08-25T10:00:00-04:00",
    assigned_tutors: [],
  },
];

// PROPOSED: who can be assigned. Tutors and Managers only, never Admins.
export const ASSIGNABLE: AssignableStaff[] = [
  { ...ANA, subjects: [{ subject_id: "sub-math", name: "Math", max_grade_level: 6 }, { subject_id: "sub-reading", name: "Reading", max_grade_level: 5 }] },
  { ...DANIELA, subjects: [{ subject_id: "sub-reading", name: "Reading", max_grade_level: 6 }] },
  { id: "u-jordan", name: "Jordan Blake", role: "tutor", subjects: [{ subject_id: "sub-science", name: "Science", max_grade_level: 8 }, { subject_id: "sub-reading", name: "Reading", max_grade_level: 8 }] },
  { ...MARCO, subjects: [{ subject_id: "sub-math", name: "Math", max_grade_level: 8 }, { subject_id: "sub-reading", name: "Reading", max_grade_level: 4 }] },
  { ...PRIYA, subjects: [{ subject_id: "sub-math", name: "Math", max_grade_level: 8 }, { subject_id: "sub-science", name: "Science", max_grade_level: 8 }] },
];

// Approving Time off over live Bookings puts those Bookings in To do.
export function toClashBooking(
  item: ExceptionRead,
  clash: ExceptionRead["clashing_bookings"][number],
): BookingSummary {
  return toBooking({
    id: clash.booking_id,
    child: clash.child_name,
    staff: item.staff,
    kind: "regular",
    subject: null,
    level: null,
    start: clash.start_time,
    end: clash.end_time,
    status: clash.status,
    home: null,
    date: clash.date,
    reasons: ["time_off_clash"],
  });
}

function toBookingPage(items: BookingSummary[]): BookingPage {
  return {
    ...toPage(items),
    counts_by_kind: {
      regular: items.filter((item) => item.kind === "regular").length,
      evaluation: items.filter((item) => item.kind === "evaluation").length,
    },
  };
}

export type HomeData = {
  counts: CountsRead;
  chats: Page<ConversationSummary>;
  // null for a Manager: Home never asks (the API would 403).
  timeOff: Page<ExceptionRead> | null;
  // null for a Manager: their To do holds Evaluations, not Booking
  // bookkeeping (TutorLink#189).
  sortOut: BookingPage | null;
  evaluations: Page<ChildSummary>;
  // PROPOSED: Evaluated Children with no Assigned Tutor, both roles
  // (Managers assign Tutors too; open question).
  needsTutor: Page<ChildSummary>;
  today: BookingPage;
};

export type OfficeRole = Exclude<Role, "tutor">;

export function getPopulated(role: OfficeRole): HomeData {
  const isAdmin = role === "admin";
  const today = isAdmin
    ? TODAY_BOOKINGS
    : TODAY_BOOKINGS.filter((item) => item.staff.id === DANIELA.id);
  return {
    counts: {
      needs_attention: NEEDS_ATTENTION.length,
      time_off_pending: isAdmin ? PENDING_TIME_OFF.length : null,
      children_awaiting_evaluation: EVALUABLE.length,
      // The API scopes a Manager's count to their own Bookings: 1 here.
      bookings_to_sort_out: isAdmin ? SORT_OUT.length : 1,
      unread_chats: NEEDS_ATTENTION.filter((item) => item.unread).length + 2,
    },
    chats: toPage(NEEDS_ATTENTION),
    timeOff: isAdmin ? toPage(PENDING_TIME_OFF) : null,
    sortOut: isAdmin ? toBookingPage(SORT_OUT) : null,
    evaluations: toPage(EVALUABLE),
    needsTutor: toPage(NEEDS_TUTOR),
    today: toBookingPage(today),
  };
}

export function getEmpty(role: OfficeRole): HomeData {
  const isAdmin = role === "admin";
  return {
    counts: {
      needs_attention: 0,
      time_off_pending: isAdmin ? 0 : null,
      children_awaiting_evaluation: 0,
      bookings_to_sort_out: 0,
      unread_chats: 0,
    },
    chats: toPage([]),
    timeOff: isAdmin ? toPage([]) : null,
    sortOut: isAdmin ? toBookingPage([]) : null,
    evaluations: toPage([]),
    needsTutor: toPage([]),
    today: toBookingPage([]),
  };
}
