// The prototype's in-memory database, kept as rows close to the tables
// behind the API. lib/mock-api.ts turns them into the exact wire shapes
// (ChildSummary, ClientRead, StaffRead...). Doral sample data, the same
// people as the shell kit. "Today" is the kit's TODAY, 2026-10-13.
import type {
  AvailabilityRead,
  BookingSummary,
  ChildLevelRead,
  EvaluatedRead,
  ExceptionRead,
  Language,
  RemindersWire,
  SignInStateWire,
  TutorSubjectRead,
  UserRole,
} from "@/pages/prototype/accounts-staff/types/api";

export type GuardianRow = {
  id: string;
  name: string;
  phone_number: string;
  archived: boolean;
  language: Language | null;
  language_conversation_id: string | null;
  reminders: RemindersWire;
  reminders_blocked_by_whatsapp: boolean;
};

export type HomeRow = {
  id: string;
  label: string | null;
  address: string;
  directions: string | null;
  archived: boolean;
  guardian_ids: string[];
};

export type ChildRow = {
  id: string;
  name: string;
  date_of_birth: string | null;
  grade_level: number | null;
  school_name: string;
  notes: string | null;
  archived: boolean;
  guardian_ids: string[];
  levels: ChildLevelRead[];
  evaluated: EvaluatedRead | null;
  created_at: string;
};

export type StaffRow = {
  id: string;
  name: string;
  role: UserRole;
  tutor_id: string | null;
  email: string;
  phone_number: string;
  bio: string | null;
  sign_in_state: SignInStateWire;
  invite_expires_at: string | null;
  archived: boolean;
  subjects: TutorSubjectRead[];
};

export type Database = {
  guardians: GuardianRow[];
  homes: HomeRow[];
  children: ChildRow[];
  staff: StaffRow[];
  availability: AvailabilityRead[];
  timeOff: ExceptionRead[];
  bookings: BookingSummary[];
};

export const TODAY = "2026-10-13";
export const NOW_ISO = "2026-10-13T08:40:00-04:00";

export const SUBJECTS = [
  { id: "sub-math", name: "Math" },
  { id: "sub-reading", name: "Reading" },
  { id: "sub-writing", name: "Writing" },
  { id: "sub-science", name: "Science" },
];

const MARIA = { id: "u-maria", name: "Maria Lopez" };
const DANIELA = { id: "u-daniela", name: "Daniela Cruz" };

const GUARDIANS: GuardianRow[] = [
  { id: "g-laura", name: "Laura Martinez", phone_number: "+13055550142", archived: false, language: "es", language_conversation_id: "cv-1", reminders: "opt_in", reminders_blocked_by_whatsapp: false },
  { id: "g-jorge", name: "Jorge Martinez", phone_number: "+13055550177", archived: false, language: "en", language_conversation_id: "cv-2", reminders: "opt_out", reminders_blocked_by_whatsapp: false },
  // Jorge's new partner: her Child Lucia links Jorge too, so the
  // household (connected Guardians and Children) holds both families.
  { id: "g-paula", name: "Paula Reyes", phone_number: "+17865550126", archived: false, language: "es", language_conversation_id: "cv-11", reminders: "opt_in", reminders_blocked_by_whatsapp: false },
  { id: "g-patricia", name: "Patricia Ortiz", phone_number: "+17865550198", archived: false, language: "en", language_conversation_id: "cv-3", reminders: "never", reminders_blocked_by_whatsapp: false },
  { id: "g-monica", name: "Monica Gomez", phone_number: "+13055550117", archived: false, language: "es", language_conversation_id: "cv-4", reminders: "opt_in", reminders_blocked_by_whatsapp: true },
  { id: "g-luis", name: "Luis Gomez", phone_number: "+13055550118", archived: false, language: null, language_conversation_id: null, reminders: "never", reminders_blocked_by_whatsapp: false },
  { id: "g-ricardo", name: "Ricardo Torres", phone_number: "+17865550163", archived: false, language: "es", language_conversation_id: "cv-5", reminders: "opt_out", reminders_blocked_by_whatsapp: false },
  { id: "g-julia", name: "Julia Castillo", phone_number: "+13055550189", archived: false, language: "en", language_conversation_id: "cv-6", reminders: "opt_in", reminders_blocked_by_whatsapp: false },
  { id: "g-rosa", name: "Rosa Sanchez", phone_number: "+17865550131", archived: false, language: "es", language_conversation_id: "cv-7", reminders: "never", reminders_blocked_by_whatsapp: false },
  { id: "g-elena", name: "Elena Fernandez", phone_number: "+19545550124", archived: false, language: "es", language_conversation_id: "cv-8", reminders: "never", reminders_blocked_by_whatsapp: false },
  { id: "g-carlos", name: "Carlos Rojas", phone_number: "+17865550109", archived: false, language: "en", language_conversation_id: "cv-10", reminders: "never", reminders_blocked_by_whatsapp: false },
  { id: "g-andrea", name: "Andrea Silva", phone_number: "+13055550150", archived: true, language: "en", language_conversation_id: "cv-9", reminders: "opt_out", reminders_blocked_by_whatsapp: false },
];

const HOMES: HomeRow[] = [
  { id: "h-laura", label: "Mom’s", address: "5600 NW 105th Ct, Doral, FL 33178", directions: "Gate code 4512, blue door on the left.", archived: false, guardian_ids: ["g-laura"] },
  { id: "h-laura-old", label: null, address: "4300 NW 79th Ave, Doral, FL 33166", directions: null, archived: true, guardian_ids: ["g-laura"] },
  { id: "h-jorge", label: "Dad’s", address: "9821 NW 41st St, Apt 12, Doral, FL 33178", directions: "Every other weekend. Visitor parking by the pool.", archived: false, guardian_ids: ["g-jorge", "g-paula"] },
  { id: "h-ortiz", label: null, address: "7701 NW 107th Ave, Unit 3, Doral, FL 33178", directions: null, archived: false, guardian_ids: ["g-patricia"] },
  { id: "h-gomez", label: null, address: "3300 NW 87th Ave, Apt 4B, Doral, FL 33172", directions: "Visitor parking, call on arrival.", archived: false, guardian_ids: ["g-monica", "g-luis"] },
  { id: "h-gomez-abuela", label: "Grandma’s", address: "2050 NW 97th Ave, Doral, FL 33172", directions: "Tuesdays only.", archived: false, guardian_ids: ["g-monica"] },
  { id: "h-torres", label: null, address: "8700 NW 36th St, Doral, FL 33166", directions: "Ring the bell twice, the dog is friendly.", archived: false, guardian_ids: ["g-ricardo"] },
  { id: "h-castillo", label: null, address: "10550 NW 66th St, Doral, FL 33178", directions: null, archived: false, guardian_ids: ["g-julia"] },
  { id: "h-fernandez", label: null, address: "5250 NW 109th Ave, Apt 210, Doral, FL 33178", directions: null, archived: false, guardian_ids: ["g-elena"] },
  { id: "h-silva", label: null, address: "10200 NW 41st St, Doral, FL 33178", directions: null, archived: false, guardian_ids: ["g-andrea"] },
];

function level(subject: { id: string; name: string }, grade: number, by = MARIA): ChildLevelRead {
  return { subject_id: subject.id, name: subject.name, archived: false, level: grade, set_by: by, updated_at: "2026-09-20T15:10:00-04:00" };
}

const [MATH, READING, WRITING, SCIENCE] = SUBJECTS;

const CHILDREN: ChildRow[] = [
  { id: "c-sofia", name: "Sofia Martinez", date_of_birth: "2016-04-11", grade_level: 4, school_name: "Doral Academy", notes: "Gets anxious with fractions; likes drawing. Mom prefers WhatsApp in Spanish.", archived: false, guardian_ids: ["g-laura", "g-jorge"], levels: [level(MATH, 4), level(READING, 5, DANIELA)], evaluated: { at: "2026-08-28T17:00:00-04:00", by: MARIA }, created_at: "2026-08-10T12:00:00-04:00" },
  { id: "c-daniel", name: "Daniel Ortiz", date_of_birth: "2017-09-02", grade_level: 3, school_name: "Eugenia B. Thomas K-8", notes: "Shy at first, warms up with games.", archived: false, guardian_ids: ["g-patricia"], levels: [], evaluated: null, created_at: "2026-10-08T09:30:00-04:00" },
  { id: "c-isabella", name: "Isabella Gomez", date_of_birth: "2015-12-19", grade_level: 5, school_name: "Doral Academy", notes: "Needs frequent short breaks.", archived: false, guardian_ids: ["g-monica", "g-luis"], levels: [level(WRITING, 5), level(MATH, 4)], evaluated: { at: "2026-06-12T16:00:00-04:00", by: DANIELA }, created_at: "2026-05-30T10:00:00-04:00" },
  { id: "c-tomas", name: "Tomas Gomez", date_of_birth: "2019-07-30", grade_level: 1, school_name: "Doral Academy", notes: null, archived: false, guardian_ids: ["g-monica", "g-luis"], levels: [], evaluated: null, created_at: "2026-10-01T18:20:00-04:00" },
  { id: "c-gabriel", name: "Gabriel Torres", date_of_birth: "2018-03-14", grade_level: 2, school_name: "John I. Smith K-8", notes: null, archived: false, guardian_ids: ["g-ricardo"], levels: [level(READING, 2)], evaluated: { at: "2026-07-03T11:00:00-04:00", by: MARIA }, created_at: "2026-06-20T08:00:00-04:00" },
  { id: "c-emma", name: "Emma Castillo", date_of_birth: "2017-01-25", grade_level: null, school_name: "Doral Academy", notes: null, archived: false, guardian_ids: ["g-julia"], levels: [level(MATH, 3)], evaluated: { at: "2026-09-01T15:00:00-04:00", by: DANIELA }, created_at: "2026-08-22T08:00:00-04:00" },
  { id: "c-leo", name: "Leo Sanchez", date_of_birth: "2017-11-05", grade_level: 3, school_name: "Ronald W. Reagan", notes: null, archived: false, guardian_ids: ["g-rosa"], levels: [], evaluated: null, created_at: "2026-10-12T19:45:00-04:00" },
  { id: "c-noah", name: "Noah Fernandez", date_of_birth: "2014-06-08", grade_level: 6, school_name: "Doral Middle", notes: null, archived: false, guardian_ids: ["g-elena"], levels: [], evaluated: null, created_at: "2026-10-05T14:00:00-04:00" },
  { id: "c-lucia", name: "Lucia Martinez", date_of_birth: "2020-05-03", grade_level: 0, school_name: "Doral Academy", notes: null, archived: false, guardian_ids: ["g-jorge", "g-paula"], levels: [level(READING, 0)], evaluated: { at: "2026-09-15T10:00:00-04:00", by: DANIELA }, created_at: "2026-09-01T10:00:00-04:00" },
  { id: "c-mateo", name: "Mateo Silva", date_of_birth: "2014-02-17", grade_level: 6, school_name: "Doral Middle", notes: null, archived: true, guardian_ids: ["g-andrea"], levels: [level(SCIENCE, 6)], evaluated: { at: "2026-03-10T15:00:00-04:00", by: MARIA }, created_at: "2026-02-01T10:00:00-05:00" },
];

function tutorSubject(subject: { id: string; name: string }, max: number): TutorSubjectRead {
  return { subject_id: subject.id, name: subject.name, max_grade_level: max };
}

const STAFF: StaffRow[] = [
  { id: "u-maria", name: "Maria Lopez", role: "admin", tutor_id: null, email: "maria@mshelpinghands.com", phone_number: "+13055550100", bio: null, sign_in_state: "active", invite_expires_at: null, archived: false, subjects: [] },
  { id: "u-carmen", name: "Carmen Vidal", role: "admin", tutor_id: null, email: "carmen@mshelpinghands.com", phone_number: "+13055550101", bio: null, sign_in_state: "active", invite_expires_at: null, archived: false, subjects: [] },
  { id: "u-daniela", name: "Daniela Cruz", role: "manager", tutor_id: "t-daniela", email: "daniela@mshelpinghands.com", phone_number: "+13055550102", bio: "Former 2nd-grade teacher. Runs most Evaluation sessions.", sign_in_state: "active", invite_expires_at: null, archived: false, subjects: [tutorSubject(READING, 6), tutorSubject(WRITING, 8)] },
  { id: "u-ana", name: "Ana Ruiz", role: "tutor", tutor_id: "t-ana", email: "ana.ruiz@gmail.com", phone_number: "+17865550111", bio: "FIU education student. Patient with anxious learners.", sign_in_state: "active", invite_expires_at: null, archived: false, subjects: [tutorSubject(MATH, 6), tutorSubject(READING, 5), tutorSubject(WRITING, 5)] },
  { id: "u-marco", name: "Marco Diaz", role: "tutor", tutor_id: "t-marco", email: "marco.diaz@outlook.com", phone_number: "+13055550121", bio: "Math tutor for 6 years, bilingual English/Spanish.", sign_in_state: "active", invite_expires_at: null, archived: false, subjects: [tutorSubject(MATH, 8), tutorSubject(READING, 4)] },
  { id: "u-priya", name: "Priya Patel", role: "tutor", tutor_id: "t-priya", email: "priya.p@gmail.com", phone_number: "+19545550133", bio: null, sign_in_state: "invited", invite_expires_at: "2026-10-11T12:00:00-04:00", archived: false, subjects: [tutorSubject(MATH, 8), tutorSubject(SCIENCE, 8)] },
  { id: "u-jordan", name: "Jordan Blake", role: "tutor", tutor_id: "t-jordan", email: "jblake@gmail.com", phone_number: "+17865550144", bio: "Science and reading, middle school.", sign_in_state: "active", invite_expires_at: null, archived: false, subjects: [tutorSubject(SCIENCE, 8), tutorSubject(READING, 8)] },
  { id: "u-sam", name: "Sam Okafor", role: "tutor", tutor_id: "t-sam", email: "sam.okafor@gmail.com", phone_number: "+13055550155", bio: null, sign_in_state: "not_invited", invite_expires_at: null, archived: false, subjects: [tutorSubject(READING, 3)] },
  { id: "u-lena", name: "Lena Brooks", role: "tutor", tutor_id: "t-lena", email: "lena.brooks@gmail.com", phone_number: "+13055550166", bio: null, sign_in_state: "active", invite_expires_at: null, archived: true, subjects: [tutorSubject(WRITING, 6)] },
  { id: "u-victor", name: "Victor Hale", role: "manager", tutor_id: "t-victor", email: "victor@mshelpinghands.com", phone_number: "+13055550177", bio: null, sign_in_state: "active", invite_expires_at: null, archived: true, subjects: [tutorSubject(MATH, 5)] },
];

function slot(id: string, tutorId: string, day: number, start: string, end: string, mode: AvailabilityRead["mode"]): AvailabilityRead {
  return { id, tutor_id: tutorId, day_of_week: day, start_time: `${start}:00`, end_time: `${end}:00`, is_active: true, mode };
}

const AVAILABILITY: AvailabilityRead[] = [
  slot("av1", "t-marco", 0, "15:00", "19:00", "traveler"),
  slot("av2", "t-marco", 1, "09:00", "12:00", "only_office"),
  slot("av3", "t-marco", 1, "15:00", "19:00", "anywhere"),
  slot("av4", "t-marco", 3, "15:00", "19:00", "anywhere"),
  slot("av5", "t-marco", 5, "09:00", "13:00", "only_office"),
  slot("av6", "t-ana", 0, "15:00", "18:00", "traveler"),
  slot("av7", "t-ana", 2, "15:00", "19:00", "anywhere"),
  slot("av8", "t-ana", 4, "14:00", "18:00", "anywhere"),
  slot("av9", "t-daniela", 1, "15:00", "18:00", "anywhere"),
  slot("av10", "t-daniela", 3, "14:00", "17:00", "traveler"),
  slot("av11", "t-jordan", 2, "16:00", "19:00", "anywhere"),
  slot("av12", "t-priya", 1, "15:00", "18:00", "only_office"),
];

function staffRef(row: { id: string; name: string }, role: UserRole) {
  return { id: row.id, name: row.name, role };
}

const MARCO_REF = staffRef({ id: "u-marco", name: "Marco Diaz" }, "tutor");
const ANA_REF = staffRef({ id: "u-ana", name: "Ana Ruiz" }, "tutor");
const DANIELA_REF = staffRef(DANIELA, "manager");

function timeOff(partial: Partial<ExceptionRead> & Pick<ExceptionRead, "id" | "staff" | "start_date" | "end_date" | "status">): ExceptionRead {
  return {
    start_time: null,
    end_time: null,
    reason: null,
    created_at: "2026-10-09T10:00:00-04:00",
    decided_by: null,
    decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    clashing_bookings: [],
    clashing_bookings_count: 0,
    ...partial,
  };
}

const TIME_OFF: ExceptionRead[] = [
  timeOff({ id: "to1", staff: MARCO_REF, start_date: "2026-10-20", end_date: "2026-10-22", status: "pending", reason: "Family trip", clashing_bookings: [{ booking_id: "bk-m3", date: "2026-10-20", start_time: "15:00:00", end_time: "16:00:00", child_name: "Sofia Martinez", status: "confirmed" }], clashing_bookings_count: 1 }),
  timeOff({ id: "to2", staff: MARCO_REF, start_date: "2026-09-08", end_date: "2026-09-09", status: "approved", reason: "Sick", decided_by: MARIA, decided_at: "2026-09-07T18:00:00-04:00" }),
  timeOff({ id: "to3", staff: MARCO_REF, start_date: "2026-08-14", end_date: "2026-08-14", status: "rejected", reason: "Concert", decided_by: MARIA, decided_at: "2026-08-10T09:00:00-04:00" }),
  timeOff({ id: "to4", staff: DANIELA_REF, start_date: "2026-10-24", end_date: "2026-10-24", start_time: "13:00:00", end_time: "17:00:00", status: "pending", reason: "Doctor’s appointment" }),
  timeOff({ id: "to5", staff: ANA_REF, start_date: "2026-11-26", end_date: "2026-11-27", status: "approved", reason: "Thanksgiving", decided_by: MARIA, decided_at: "2026-10-01T10:00:00-04:00" }),
  timeOff({ id: "to6", staff: staffRef({ id: "u-priya", name: "Priya Patel" }, "tutor"), start_date: "2026-10-30", end_date: "2026-10-30", status: "pending", reason: "Graduation ceremony" }),
];

type BookingSeed = {
  id: string;
  child: { id: string; name: string };
  staff: { id: string; name: string; role: UserRole };
  kind: BookingSummary["kind"];
  subject: { id: string; name: string } | null;
  level: number | null;
  date: string;
  start: string;
  end: string;
  status: BookingSummary["status"];
  home: { id: string; label: string | null; address: string } | null;
};

function booking(seed: BookingSeed): BookingSummary {
  return {
    id: seed.id,
    child: seed.child,
    staff: seed.staff,
    kind: seed.kind,
    location: seed.home ? "home" : "in_office",
    subject: seed.subject,
    subject_level: seed.level,
    scheduled_date: seed.date,
    start_time: `${seed.start}:00`,
    end_time: `${seed.end}:00`,
    status: seed.status,
    notes: null,
    home: seed.home,
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    updated_at: "2026-10-10T09:00:00-04:00",
  };
}

function homeRef(id: string): { id: string; label: string | null; address: string } {
  const home = HOMES.find((row) => row.id === id);
  if (!home) throw new Error(`No mock Home ${id}`);
  return { id: home.id, label: home.label, address: home.address };
}

const SOFIA = { id: "c-sofia", name: "Sofia Martinez" };
const ISABELLA = { id: "c-isabella", name: "Isabella Gomez" };
const GABRIEL = { id: "c-gabriel", name: "Gabriel Torres" };
const EMMA = { id: "c-emma", name: "Emma Castillo" };
const DANIEL = { id: "c-daniel", name: "Daniel Ortiz" };
const TOMAS = { id: "c-tomas", name: "Tomas Gomez" };
const LUCIA = { id: "c-lucia", name: "Lucia Martinez" };

const BOOKINGS: BookingSummary[] = [
  booking({ id: "bk-m1", child: EMMA, staff: MARCO_REF, kind: "regular", subject: MATH, level: 3, date: "2026-10-13", start: "17:00", end: "18:00", status: "confirmed", home: null }),
  booking({ id: "bk-m2", child: SOFIA, staff: MARCO_REF, kind: "regular", subject: MATH, level: 4, date: "2026-10-15", start: "15:00", end: "16:00", status: "confirmed", home: homeRef("h-laura") }),
  booking({ id: "bk-m3", child: SOFIA, staff: MARCO_REF, kind: "regular", subject: MATH, level: 4, date: "2026-10-20", start: "15:00", end: "16:00", status: "confirmed", home: homeRef("h-jorge") }),
  booking({ id: "bk-m4", child: GABRIEL, staff: MARCO_REF, kind: "regular", subject: READING, level: 2, date: "2026-10-21", start: "16:30", end: "17:30", status: "pending", home: homeRef("h-torres") }),
  booking({ id: "bk-m0", child: EMMA, staff: MARCO_REF, kind: "regular", subject: MATH, level: 3, date: "2026-10-06", start: "17:00", end: "18:00", status: "completed", home: null }),
  booking({ id: "bk-a1", child: ISABELLA, staff: ANA_REF, kind: "regular", subject: WRITING, level: 5, date: "2026-10-13", start: "15:30", end: "16:30", status: "confirmed", home: homeRef("h-gomez") }),
  booking({ id: "bk-a2", child: SOFIA, staff: ANA_REF, kind: "regular", subject: READING, level: 5, date: "2026-10-16", start: "17:00", end: "18:00", status: "confirmed", home: homeRef("h-laura") }),
  booking({ id: "bk-d1", child: DANIEL, staff: DANIELA_REF, kind: "evaluation", subject: null, level: null, date: "2026-10-14", start: "11:30", end: "13:00", status: "confirmed", home: null }),
  booking({ id: "bk-d2", child: GABRIEL, staff: DANIELA_REF, kind: "regular", subject: READING, level: 2, date: "2026-10-17", start: "16:00", end: "17:00", status: "pending", home: homeRef("h-torres") }),
  // Past Bookings, for the family overview's Recent sessions.
  booking({ id: "bk-p1", child: SOFIA, staff: MARCO_REF, kind: "regular", subject: MATH, level: 4, date: "2026-10-08", start: "15:00", end: "16:00", status: "completed", home: homeRef("h-laura") }),
  booking({ id: "bk-p2", child: SOFIA, staff: ANA_REF, kind: "regular", subject: READING, level: 5, date: "2026-10-11", start: "10:00", end: "11:00", status: "completed", home: homeRef("h-jorge") }),
  booking({ id: "bk-p3", child: SOFIA, staff: MARCO_REF, kind: "regular", subject: MATH, level: 4, date: "2026-10-01", start: "15:00", end: "16:00", status: "cancelled", home: homeRef("h-laura") }),
  booking({ id: "bk-p4", child: ISABELLA, staff: ANA_REF, kind: "regular", subject: WRITING, level: 5, date: "2026-10-06", start: "15:30", end: "16:30", status: "completed", home: homeRef("h-gomez") }),
  booking({ id: "bk-p5", child: TOMAS, staff: DANIELA_REF, kind: "evaluation", subject: null, level: null, date: "2026-10-10", start: "11:30", end: "13:00", status: "completed", home: null }),
  booking({ id: "bk-p6", child: ISABELLA, staff: MARCO_REF, kind: "regular", subject: MATH, level: 4, date: "2026-10-12", start: "17:00", end: "18:00", status: "confirmed", home: homeRef("h-gomez-abuela") }),
  // Lucia, Sofia's half-sister: same days as Sofia some weeks.
  booking({ id: "bk-l1", child: LUCIA, staff: DANIELA_REF, kind: "regular", subject: READING, level: 0, date: "2026-10-08", start: "16:30", end: "17:15", status: "completed", home: homeRef("h-jorge") }),
  booking({ id: "bk-l2", child: LUCIA, staff: DANIELA_REF, kind: "regular", subject: READING, level: 0, date: "2026-10-14", start: "16:30", end: "17:15", status: "cancelled", home: homeRef("h-jorge") }),
  booking({ id: "bk-l3", child: LUCIA, staff: DANIELA_REF, kind: "regular", subject: READING, level: 0, date: "2026-10-15", start: "16:30", end: "17:15", status: "confirmed", home: homeRef("h-jorge") }),
  booking({ id: "bk-l4", child: LUCIA, staff: ANA_REF, kind: "regular", subject: READING, level: 0, date: "2026-10-20", start: "16:30", end: "17:15", status: "pending", home: homeRef("h-jorge") }),
  booking({ id: "bk-s5", child: SOFIA, staff: ANA_REF, kind: "regular", subject: READING, level: 5, date: "2026-10-23", start: "17:00", end: "18:00", status: "confirmed", home: homeRef("h-laura") }),
  booking({ id: "bk-s6", child: SOFIA, staff: MARCO_REF, kind: "regular", subject: MATH, level: 4, date: "2026-10-06", start: "15:00", end: "16:00", status: "completed", home: homeRef("h-laura") }),
  booking({ id: "bk-i3", child: ISABELLA, staff: ANA_REF, kind: "regular", subject: WRITING, level: 5, date: "2026-10-20", start: "15:30", end: "16:30", status: "confirmed", home: homeRef("h-gomez") }),
  booking({ id: "bk-p7", child: GABRIEL, staff: DANIELA_REF, kind: "regular", subject: READING, level: 2, date: "2026-10-07", start: "16:00", end: "17:00", status: "completed", home: homeRef("h-torres") }),
];

export function createDatabase(): Database {
  return {
    guardians: GUARDIANS.map((row) => ({ ...row })),
    homes: HOMES.map((row) => ({ ...row, guardian_ids: [...row.guardian_ids] })),
    children: CHILDREN.map((row) => ({ ...row, guardian_ids: [...row.guardian_ids] })),
    staff: STAFF.map((row) => ({ ...row, subjects: [...row.subjects] })),
    availability: [...AVAILABILITY],
    timeOff: [...TIME_OFF],
    bookings: [...BOOKINGS],
  };
}

export function createEmptyDatabase(): Database {
  // The signed-in Admin always exists, so Staff is never truly empty.
  return {
    guardians: [],
    homes: [],
    children: [],
    staff: STAFF.filter((row) => row.id === MARIA.id),
    availability: [],
    timeOff: [],
    bookings: [],
  };
}

export const CURRENT_STAFF_ID = { admin: "u-maria", manager: "u-daniela" } as const;
