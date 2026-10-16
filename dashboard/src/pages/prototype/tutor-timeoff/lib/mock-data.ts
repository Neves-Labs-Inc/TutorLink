// In-memory seed data, in the API's wire shapes. Business clock is the
// kit's: Tuesday 2026-10-13, 8:40 AM in Doral. Prototype only.
import type {
  AvailabilityMode,
  AvailabilityRead,
  BookingDetail,
  BookingKind,
  BookingStatus,
  ExceptionRead,
  HomeRef,
  MeRead,
  NamedRef,
  StaffRead,
  StaffRef,
} from "@/pages/prototype/tutor-timeoff/types/api";

export type AreaRole = "admin" | "manager" | "tutor";

const OFFICE_PHONE = "+13055550100";

const MARIA: StaffRef = { id: "u-maria", name: "Maria Lopez", role: "admin" };
const DANIELA: StaffRef = { id: "u-daniela", name: "Daniela Cruz", role: "manager" };
const ANA: StaffRef = { id: "u-ana", name: "Ana Ruiz", role: "tutor" };
const MARCO: StaffRef = { id: "u-marco", name: "Marco Diaz", role: "tutor" };
const PRIYA: StaffRef = { id: "u-priya", name: "Priya Patel", role: "tutor" };
const JORDAN: StaffRef = { id: "u-jordan", name: "Jordan Blake", role: "tutor" };
const SAM: StaffRef = { id: "u-sam", name: "Sam Okafor", role: "tutor" };

export const ME: Record<AreaRole, MeRead> = {
  admin: { id: MARIA.id, email: "maria@mshelpinghands.com", role: "admin", name: MARIA.name, tutor_id: null, office_phone: OFFICE_PHONE },
  manager: { id: DANIELA.id, email: "daniela@mshelpinghands.com", role: "manager", name: DANIELA.name, tutor_id: "tp-daniela", office_phone: OFFICE_PHONE },
  tutor: { id: ANA.id, email: "ana.ruiz@gmail.com", role: "tutor", name: ANA.name, tutor_id: "tp-ana", office_phone: OFFICE_PHONE },
};

function subject(name: string): NamedRef {
  return { id: `subj-${name.toLowerCase()}`, name };
}

function staffRow(
  ref: StaffRef,
  email: string,
  tutorId: string | null,
  subjects: string[],
  sessionsThisWeek: number,
): StaffRead {
  return {
    id: ref.id,
    name: ref.name,
    role: ref.role,
    tutor_id: tutorId,
    email,
    sign_in_state: "active",
    invite_expires_at: null,
    archived: false,
    subjects: subjects.map(subject),
    sessions_this_week: sessionsThisWeek,
  };
}

// GET /api/staff?archived=false: the Admin's "For" picker.
export const STAFF: StaffRead[] = [
  staffRow(MARIA, "maria@mshelpinghands.com", null, [], 0),
  staffRow(DANIELA, "daniela@mshelpinghands.com", "tp-daniela", ["Reading", "Writing"], 3),
  staffRow(ANA, "ana.ruiz@gmail.com", "tp-ana", ["Math", "Reading", "Writing"], 6),
  staffRow(MARCO, "marco.diaz@outlook.com", "tp-marco", ["Math", "Reading"], 8),
  staffRow(PRIYA, "priya.p@gmail.com", "tp-priya", ["Math", "Science"], 4),
  staffRow(JORDAN, "jblake@gmail.com", "tp-jordan", ["Science", "Reading"], 5),
  staffRow(SAM, "", "tp-sam", ["Reading"], 1),
];

const HOMES: Record<string, HomeRef> = {
  martinezMom: { id: "home-1", label: "Mom’s", address: "5600 NW 105th Ct, Doral, FL 33178", directions: "Gate code 4512, blue door on the left." },
  martinezDad: { id: "home-2", label: "Dad’s", address: "9821 NW 41st St, Apt 12, Doral, FL 33178", directions: "Every other weekend Sofia stays here. Park in visitor spot 12." },
  gomez: { id: "home-5", label: null, address: "3300 NW 87th Ave, Apt 4B, Doral, FL 33172", directions: "Visitor parking, call on arrival." },
  torres: { id: "home-6", label: null, address: "8700 NW 36th St, Doral, FL 33166", directions: "Ring the bell twice, the dog is friendly." },
  herrera: { id: "home-9", label: null, address: "8450 NW 53rd St, Doral, FL 33166", directions: null },
  reyes: { id: "home-10", label: null, address: "11010 NW 58th St, Doral, FL 33178", directions: null },
  vega: { id: "home-12", label: null, address: "9100 NW 25th St, Doral, FL 33172", directions: "Second building, take the elevator to 3." },
};

type ChildSeed = { id: string; name: string; notes: string | null; guardians: NamedRef[] };

const CHILDREN: Record<string, ChildSeed> = {
  sofia: { id: "c-sofia", name: "Sofia Martinez", notes: "Gets anxious with fractions; likes drawing. Start with something she can win.", guardians: [{ id: "g-laura", name: "Laura Martinez" }, { id: "g-jorge", name: "Jorge Martinez" }] },
  daniel: { id: "c-daniel", name: "Daniel Ortiz", notes: "First evaluation; shy at first, warms up with games.", guardians: [{ id: "g-patricia", name: "Patricia Ortiz" }] },
  isabella: { id: "c-isabella", name: "Isabella Gomez", notes: "Needs frequent short breaks. Allergic to peanuts.", guardians: [{ id: "g-monica", name: "Monica Gomez" }] },
  lucas: { id: "c-lucas", name: "Lucas Herrera", notes: null, guardians: [{ id: "g-diana", name: "Diana Herrera" }] },
  emma: { id: "c-emma", name: "Emma Castillo", notes: null, guardians: [{ id: "g-julia", name: "Julia Castillo" }] },
  camila: { id: "c-camila", name: "Camila Reyes", notes: "Bring the periodic table cards; she loves quizzes.", guardians: [{ id: "g-sandra", name: "Sandra Reyes" }] },
  gabriel: { id: "c-gabriel", name: "Gabriel Torres", notes: "Reads aloud slowly; let him finish.", guardians: [{ id: "g-ricardo", name: "Ricardo Torres" }] },
  santiago: { id: "c-santiago", name: "Santiago Vega", notes: null, guardians: [{ id: "g-maria-vega", name: "Maria Vega" }] },
  olivia: { id: "c-olivia", name: "Olivia Mendez", notes: null, guardians: [{ id: "g-teresa", name: "Teresa Mendez" }] },
  noah: { id: "c-noah", name: "Noah Fernandez", notes: null, guardians: [{ id: "g-elena", name: "Elena Fernandez" }] },
};

type BookingSeed = {
  id: string;
  staff: StaffRef;
  child: keyof typeof CHILDREN;
  kind?: BookingKind;
  subjectName?: string;
  level?: number;
  date: string;
  start: string;
  end: string;
  status?: BookingStatus;
  home?: keyof typeof HOMES;
  bookedByGuardian?: boolean;
};

const UPDATED_AT = "2026-10-09T14:12:00-04:00";

function makeBooking(seed: BookingSeed): BookingDetail {
  const child = CHILDREN[seed.child];
  const kind = seed.kind ?? "regular";
  const home = seed.home ? HOMES[seed.home] : null;
  return {
    id: seed.id,
    child: { id: child.id, name: child.name, notes: child.notes },
    staff: seed.staff,
    kind,
    location: home ? "home" : "in_office",
    subject: seed.subjectName ? subject(seed.subjectName) : null,
    subject_level: seed.level ?? null,
    scheduled_date: seed.date,
    start_time: `${seed.start}:00`,
    end_time: `${seed.end}:00`,
    status: seed.status ?? "confirmed",
    notes: null,
    home,
    booked_by_guardian: seed.bookedByGuardian ? child.guardians[0] : null,
    guardians: child.guardians.map((guardian) => ({ ...guardian, conversation_id: `conv-${guardian.id}` })),
    // Recomputed from the clock and Time off at read (lib/rules.ts).
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    updated_at: UPDATED_AT,
  };
}

export const BOOKINGS: BookingDetail[] = [
  // Ana (Tutor)
  makeBooking({ id: "bk-an-p4", staff: ANA, child: "lucas", subjectName: "Reading", level: 2, date: "2026-10-07", start: "15:00", end: "16:00", status: "cancelled", home: "herrera" }),
  makeBooking({ id: "bk-an-p3", staff: ANA, child: "sofia", subjectName: "Math", level: 4, date: "2026-10-08", start: "17:00", end: "18:00", status: "completed", home: "martinezMom" }),
  makeBooking({ id: "bk-an-p1", staff: ANA, child: "lucas", subjectName: "Reading", level: 2, date: "2026-10-12", start: "15:00", end: "16:00", status: "completed", home: "herrera" }),
  makeBooking({ id: "bk-an-p2", staff: ANA, child: "emma", subjectName: "Math", level: 3, date: "2026-10-12", start: "17:00", end: "18:00" }),
  makeBooking({ id: "bk-an-1", staff: ANA, child: "sofia", subjectName: "Math", level: 4, date: "2026-10-13", start: "09:30", end: "10:30", home: "martinezMom", bookedByGuardian: true }),
  makeBooking({ id: "bk-an-2", staff: ANA, child: "daniel", kind: "evaluation", date: "2026-10-13", start: "11:30", end: "13:00" }),
  makeBooking({ id: "bk-an-3", staff: ANA, child: "isabella", subjectName: "Writing", level: 5, date: "2026-10-13", start: "15:30", end: "16:30", home: "gomez" }),
  makeBooking({ id: "bk-an-4", staff: ANA, child: "sofia", subjectName: "Math", level: 4, date: "2026-10-15", start: "17:00", end: "18:00", home: "martinezDad", bookedByGuardian: true }),
  makeBooking({ id: "bk-an-5", staff: ANA, child: "camila", subjectName: "Science", level: 7, date: "2026-10-16", start: "16:00", end: "17:00", home: "reyes" }),
  makeBooking({ id: "bk-an-6", staff: ANA, child: "lucas", subjectName: "Reading", level: 0, date: "2026-10-19", start: "15:00", end: "16:00", home: "herrera" }),
  makeBooking({ id: "bk-an-7", staff: ANA, child: "isabella", subjectName: "Writing", level: 5, date: "2026-10-23", start: "16:00", end: "17:00", home: "gomez" }),
  // Daniela (Manager): her own teaching
  makeBooking({ id: "bk-dc-p1", staff: DANIELA, child: "gabriel", subjectName: "Reading", level: 2, date: "2026-10-12", start: "16:00", end: "17:00", home: "torres" }),
  makeBooking({ id: "bk-dc-1", staff: DANIELA, child: "gabriel", subjectName: "Reading", level: 2, date: "2026-10-13", start: "16:00", end: "17:00", home: "torres" }),
  makeBooking({ id: "bk-dc-2", staff: DANIELA, child: "santiago", subjectName: "Math", level: 5, date: "2026-10-15", start: "15:00", end: "16:00", home: "vega", bookedByGuardian: true }),
  makeBooking({ id: "bk-dc-3", staff: DANIELA, child: "olivia", kind: "evaluation", date: "2026-10-16", start: "10:00", end: "11:30" }),
  // Others, for Time off clashes
  makeBooking({ id: "bk-mc-1", staff: MARCO, child: "lucas", subjectName: "Reading", level: 2, date: "2026-10-20", start: "15:00", end: "16:00", home: "herrera" }),
  makeBooking({ id: "bk-mc-2", staff: MARCO, child: "emma", subjectName: "Math", level: 3, date: "2026-10-21", start: "17:00", end: "18:00" }),
  makeBooking({ id: "bk-jb-1", staff: JORDAN, child: "camila", subjectName: "Science", level: 7, date: "2026-10-14", start: "16:30", end: "17:30", home: "reyes" }),
  makeBooking({ id: "bk-pr-1", staff: PRIYA, child: "noah", kind: "evaluation", date: "2026-10-30", start: "14:00", end: "15:30" }),
  makeBooking({ id: "bk-sm-1", staff: SAM, child: "lucas", subjectName: "Reading", level: 2, date: "2026-11-03", start: "15:30", end: "16:30", home: "herrera" }),
];

function slot(
  id: string,
  tutorId: string,
  day: number,
  start: string,
  end: string,
  mode: AvailabilityMode,
): AvailabilityRead {
  return { id, tutor_id: tutorId, day_of_week: day, start_time: `${start}:00`, end_time: `${end}:00`, is_active: true, mode };
}

// GET /api/tutors/{tutor_id}/availability
export const AVAILABILITY: Record<string, AvailabilityRead[]> = {
  "tp-ana": [
    slot("av-1", "tp-ana", 0, "15:00", "19:00", "traveler"),
    slot("av-2", "tp-ana", 1, "09:00", "12:00", "only_office"),
    slot("av-3", "tp-ana", 1, "15:00", "19:00", "anywhere"),
    slot("av-4", "tp-ana", 2, "15:00", "18:00", "traveler"),
    slot("av-5", "tp-ana", 3, "15:00", "19:00", "anywhere"),
    slot("av-6", "tp-ana", 5, "09:00", "13:00", "only_office"),
  ],
  "tp-daniela": [
    slot("av-d1", "tp-daniela", 1, "15:00", "18:00", "anywhere"),
    slot("av-d2", "tp-daniela", 3, "14:00", "17:00", "traveler"),
    slot("av-d3", "tp-daniela", 4, "09:00", "12:00", "only_office"),
  ],
};

// Stored rows: the derived fields (expired, clashes) are filled at read
// time by lib/rules.ts, as the API does.
export type ExceptionRow = Omit<
  ExceptionRead,
  "clashing_bookings" | "clashing_bookings_count"
>;

function timeOff(
  id: string,
  staff: StaffRef,
  window: { from: string; to?: string; startTime?: string; endTime?: string },
  reason: string | null,
  status: ExceptionRow["status"],
  createdAt: string,
  decision?: { by: StaffRef; at: string; isCancel?: boolean },
): ExceptionRow {
  const isCancel = decision?.isCancel ?? false;
  return {
    id,
    staff,
    start_date: window.from,
    end_date: window.to ?? window.from,
    start_time: window.startTime ? `${window.startTime}:00` : null,
    end_time: window.endTime ? `${window.endTime}:00` : null,
    reason,
    status,
    created_at: createdAt,
    decided_by: decision && !isCancel ? { id: decision.by.id, name: decision.by.name } : null,
    decided_at: decision && !isCancel ? decision.at : null,
    cancelled_by: decision && isCancel ? { id: decision.by.id, name: decision.by.name } : null,
    cancelled_at: decision && isCancel ? decision.at : null,
  };
}

export const TIME_OFF: ExceptionRow[] = [
  timeOff("to-1", MARCO, { from: "2026-10-20", to: "2026-10-22" }, "Family trip", "pending", "2026-10-11T19:02:00-04:00"),
  timeOff("to-2", DANIELA, { from: "2026-10-24", startTime: "13:00", endTime: "17:00" }, "Doctor’s appointment", "pending", "2026-10-12T09:15:00-04:00"),
  timeOff("to-3", PRIYA, { from: "2026-10-30" }, "Graduation ceremony", "pending", "2026-10-12T21:40:00-04:00"),
  timeOff("to-4", SAM, { from: "2026-11-02", to: "2026-11-06" }, "Moving house", "pending", "2026-10-13T07:58:00-04:00"),
  timeOff("to-5", ANA, { from: "2026-10-23", startTime: "14:00", endTime: "18:00" }, "Dentist", "pending", "2026-10-12T18:20:00-04:00"),
  // Pending, but its window ended before anyone decided: reads Expired.
  timeOff("to-6", JORDAN, { from: "2026-10-09" }, null, "pending", "2026-10-05T10:00:00-04:00"),
  timeOff("to-7", JORDAN, { from: "2026-10-14" }, "Jury duty", "approved", "2026-10-01T11:00:00-04:00", { by: MARIA, at: "2026-10-01T15:30:00-04:00" }),
  timeOff("to-8", ANA, { from: "2026-11-26", to: "2026-11-27" }, "Thanksgiving", "approved", "2026-09-28T08:00:00-04:00", { by: MARIA, at: "2026-09-28T12:10:00-04:00" }),
  // An Admin's own: approved the moment she entered it.
  timeOff("to-9", MARIA, { from: "2026-12-22", to: "2027-01-02" }, "Holidays", "approved", "2026-09-15T10:00:00-04:00", { by: MARIA, at: "2026-09-15T10:00:00-04:00" }),
  timeOff("to-10", PRIYA, { from: "2026-11-11" }, "Exam", "rejected", "2026-10-06T16:00:00-04:00", { by: MARIA, at: "2026-10-07T09:00:00-04:00" }),
  timeOff("to-11", DANIELA, { from: "2026-09-18" }, "Family event", "approved", "2026-09-10T12:00:00-04:00", { by: MARIA, at: "2026-09-10T17:00:00-04:00" }),
  timeOff("to-12", ANA, { from: "2026-10-03" }, "Car in the shop", "rejected", "2026-10-01T07:30:00-04:00", { by: MARIA, at: "2026-10-01T09:05:00-04:00" }),
  timeOff("to-13", MARCO, { from: "2026-09-08", to: "2026-09-09" }, "Sick", "approved", "2026-09-08T06:45:00-04:00", { by: MARIA, at: "2026-09-08T06:45:00-04:00" }),
  timeOff("to-14", ANA, { from: "2026-10-09", startTime: "15:00", endTime: "17:00" }, "School pickup", "cancelled", "2026-10-02T13:00:00-04:00", { by: ANA, at: "2026-10-04T08:00:00-04:00", isCancel: true }),
];

export const COUNTS_BASE = {
  needs_attention: 4,
  children_awaiting_evaluation: 2,
  bookings_to_sort_out: 3,
  unread_chats: 2,
};
