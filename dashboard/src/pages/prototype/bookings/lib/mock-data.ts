// In-memory sample data for the Bookings prototype, in the API's wire
// shapes (./wire.ts). Same Doral business and week as the shell kit:
// today is Tue Oct 13 2026, 8:40 AM. Prototype only.
import type {
  BookingDetail,
  BookingKind,
  BookingStatus,
  ChildSummary,
  ExceptionRead,
  HomeRef,
  NamedRef,
  StaffRead,
  StaffRef,
} from "@/pages/prototype/bookings/lib/wire";

export const TODAY = "2026-10-13";
export const NOW_TIME = "08:40:00";
export const WEEK_START = "2026-10-12";

// Settings: default lengths the form pre-fills (minutes).
export const SESSION_MINUTES: Record<BookingKind, number> = {
  regular: 60,
  evaluation: 90,
};

export const SUBJECTS: NamedRef[] = [
  { id: "subj-math", name: "Math" },
  { id: "subj-reading", name: "Reading" },
  { id: "subj-writing", name: "Writing" },
  { id: "subj-science", name: "Science" },
];

function getSubject(name: string): NamedRef {
  return SUBJECTS.find((subject) => subject.name === name) ?? SUBJECTS[0];
}

type StaffSeed = [
  key: string,
  name: string,
  role: StaffRead["role"],
  subjects: string[],
  signIn: StaffRead["sign_in_state"],
  isArchived: boolean,
];

const STAFF_SEED: StaffSeed[] = [
  ["maria", "Maria Lopez", "admin", ["Math", "Reading"], "active", false],
  ["daniela", "Daniela Cruz", "manager", ["Reading", "Writing", "Math"], "active", false],
  ["ana", "Ana Ruiz", "tutor", ["Math", "Reading", "Writing"], "active", false],
  ["marco", "Marco Diaz", "tutor", ["Math", "Reading"], "active", false],
  ["priya", "Priya Patel", "tutor", ["Math", "Science"], "invited", false],
  ["jordan", "Jordan Blake", "tutor", ["Science", "Reading"], "active", false],
  ["sam", "Sam Okafor", "tutor", ["Reading"], "not_invited", false],
  ["lena", "Lena Brooks", "tutor", ["Writing", "Math"], "active", true],
];

export const STAFF: StaffRead[] = STAFF_SEED.map(
  ([key, name, role, subjects, signIn, isArchived]) => ({
    id: `user-${key}`,
    name,
    role,
    tutor_id: role === "admin" ? null : `tutor-${key}`,
    email: `${key}@mshelpinghands.com`,
    sign_in_state: signIn,
    invite_expires_at: null,
    archived: isArchived,
    subjects: subjects.map(getSubject),
    sessions_this_week: 0,
  }),
);

export function getStaffRef(key: string): StaffRef {
  const staff = STAFF.find((item) => item.id === `user-${key}`) ?? STAFF[0];
  return { id: staff.id, name: staff.name, role: staff.role };
}

// The signed-in person per prototype role.
export const CURRENT_STAFF_ID = { admin: "user-maria", manager: "user-daniela" };

type HomeSeed = HomeRef & { guardianKeys: string[] };

const HOMES: Record<string, HomeSeed> = {
  "martinez-mom": { id: "home-1", label: "Mom’s", address: "5600 NW 105th Ct, Doral, FL 33178", directions: "Gate code 4512, blue door on the left.", guardianKeys: ["laura"] },
  "martinez-dad": { id: "home-2", label: "Dad’s", address: "9821 NW 41st St, Apt 12, Doral, FL 33178", directions: "Every other weekend Sofia stays here.", guardianKeys: ["jorge"] },
  gomez: { id: "home-5", label: null, address: "3300 NW 87th Ave, Apt 4B, Doral, FL 33172", directions: "Visitor parking, call on arrival.", guardianKeys: ["monica"] },
  torres: { id: "home-6", label: null, address: "8700 NW 36th St, Doral, FL 33166", directions: "Ring the bell twice, the dog is friendly.", guardianKeys: ["ricardo"] },
  herrera: { id: "home-9", label: null, address: "8450 NW 53rd St, Doral, FL 33166", directions: null, guardianKeys: ["diana"] },
  reyes: { id: "home-10", label: null, address: "11010 NW 58th St, Doral, FL 33178", directions: null, guardianKeys: ["sandra"] },
  silva: { id: "home-11", label: null, address: "10200 NW 41st St, Doral, FL 33178", directions: "Side entrance by the garage.", guardianKeys: ["andrea"] },
  vega: { id: "home-12", label: null, address: "9100 NW 25th St, Doral, FL 33172", directions: null, guardianKeys: ["mvega"] },
  sanchez: { id: "home-13", label: null, address: "5250 NW 109th Ave, Apt 210, Doral, FL 33178", directions: null, guardianKeys: ["rosa"] },
};

const GUARDIANS: Record<string, NamedRef & { conversationId: string | null }> = {
  laura: { id: "guardian-g1", name: "Laura Martinez", conversationId: "conv-ch1" },
  jorge: { id: "guardian-g7", name: "Jorge Martinez", conversationId: null },
  monica: { id: "guardian-g3", name: "Monica Gomez", conversationId: "conv-ch7" },
  ricardo: { id: "guardian-g4", name: "Ricardo Torres", conversationId: "conv-ch5" },
  patricia: { id: "guardian-g2", name: "Patricia Ortiz", conversationId: "conv-ch3" },
  elena: { id: "guardian-g6", name: "Elena Fernandez", conversationId: null },
  rosa: { id: "guardian-g8", name: "Rosa Sanchez", conversationId: "conv-ch9" },
  diana: { id: "guardian-g9", name: "Diana Herrera", conversationId: "conv-ch10" },
  sandra: { id: "guardian-g10", name: "Sandra Reyes", conversationId: "conv-ch4" },
  andrea: { id: "guardian-g11", name: "Andrea Silva", conversationId: "conv-ch6" },
  mvega: { id: "guardian-g12", name: "Maria Vega", conversationId: null },
  julia: { id: "guardian-g5", name: "Julia Castillo", conversationId: "conv-ch11" },
  carlos: { id: "guardian-g13", name: "Carlos Rojas", conversationId: "conv-ch2" },
  teresa: { id: "guardian-g14", name: "Teresa Mendez", conversationId: null },
};

type ChildSeed = {
  id: string;
  name: string;
  grade: number;
  notes: string | null;
  guardianKeys: string[];
  homeKeys: string[];
  levels: Record<string, number>;
  isEvaluated: boolean;
  createdAt: string;
  // The kit's Child id, so a tap can open the kit's Child details.
  kitId?: string;
};

const CHILD_SEEDS: Record<string, ChildSeed> = {
  sofia: { id: "child-c1", kitId: "c1", name: "Sofia Martinez", grade: 4, notes: "Gets anxious with fractions; likes drawing.", guardianKeys: ["laura", "jorge"], homeKeys: ["martinez-mom", "martinez-dad"], levels: { Math: 4 }, isEvaluated: true, createdAt: "2026-08-02T10:00:00" },
  daniel: { id: "child-c2", kitId: "c2", name: "Daniel Ortiz", grade: 3, notes: "Shy at first, warms up with games.", guardianKeys: ["patricia"], homeKeys: [], levels: {}, isEvaluated: false, createdAt: "2026-10-05T09:00:00" },
  isabella: { id: "child-c3", kitId: "c3", name: "Isabella Gomez", grade: 5, notes: "Needs frequent short breaks.", guardianKeys: ["monica"], homeKeys: ["gomez"], levels: { Writing: 5, Math: 5 }, isEvaluated: true, createdAt: "2026-06-11T10:00:00" },
  tomas: { id: "child-c4", kitId: "c4", name: "Tomas Gomez", grade: 1, notes: null, guardianKeys: ["monica"], homeKeys: ["gomez"], levels: {}, isEvaluated: false, createdAt: "2026-10-01T15:20:00" },
  gabriel: { id: "child-c5", kitId: "c5", name: "Gabriel Torres", grade: 2, notes: null, guardianKeys: ["ricardo"], homeKeys: ["torres"], levels: { Reading: 2 }, isEvaluated: true, createdAt: "2026-05-20T10:00:00" },
  noah: { id: "child-c6", kitId: "c6", name: "Noah Fernandez", grade: 6, notes: null, guardianKeys: ["elena"], homeKeys: [], levels: {}, isEvaluated: false, createdAt: "2026-10-08T12:00:00" },
  leo: { id: "child-c7", kitId: "c7", name: "Leo Sanchez", grade: 3, notes: null, guardianKeys: ["rosa"], homeKeys: ["sanchez"], levels: {}, isEvaluated: false, createdAt: "2026-10-12T18:05:00" },
  lucas: { id: "child-c8", name: "Lucas Herrera", grade: 2, notes: null, guardianKeys: ["diana"], homeKeys: ["herrera"], levels: { Reading: 2 }, isEvaluated: true, createdAt: "2026-03-02T10:00:00" },
  emma: { id: "child-c9", name: "Emma Castillo", grade: 3, notes: null, guardianKeys: ["julia"], homeKeys: [], levels: { Math: 3 }, isEvaluated: true, createdAt: "2026-04-14T10:00:00" },
  camila: { id: "child-c10", name: "Camila Reyes", grade: 7, notes: "Preparing for the science fair in November.", guardianKeys: ["sandra"], homeKeys: ["reyes"], levels: { Science: 7 }, isEvaluated: true, createdAt: "2026-02-10T10:00:00" },
  santiago: { id: "child-c11", name: "Santiago Vega", grade: 5, notes: null, guardianKeys: ["mvega"], homeKeys: ["vega"], levels: { Math: 5 }, isEvaluated: true, createdAt: "2026-01-22T10:00:00" },
  valentina: { id: "child-c12", name: "Valentina Rojas", grade: 5, notes: null, guardianKeys: ["carlos"], homeKeys: [], levels: { Math: 5 }, isEvaluated: true, createdAt: "2026-09-01T10:00:00" },
  mateo: { id: "child-c13", name: "Mateo Silva", grade: 6, notes: null, guardianKeys: ["andrea"], homeKeys: ["silva"], levels: { Science: 6 }, isEvaluated: true, createdAt: "2026-03-30T10:00:00" },
  olivia: { id: "child-c14", name: "Olivia Mendez", grade: 1, notes: null, guardianKeys: ["teresa"], homeKeys: [], levels: { Reading: 1 }, isEvaluated: true, createdAt: "2026-07-07T10:00:00" },
};

export const KIT_CHILD_ID: Record<string, string> = Object.fromEntries(
  Object.values(CHILD_SEEDS)
    .filter((seed) => seed.kitId)
    .map((seed) => [seed.id, seed.kitId ?? ""]),
);

function toChildSummary(seed: ChildSeed): ChildSummary {
  const guardians = seed.guardianKeys.map((key) => ({
    id: GUARDIANS[key].id,
    name: GUARDIANS[key].name,
  }));
  return {
    id: seed.id,
    name: seed.name,
    grade_level: seed.grade,
    school_name: "Doral Academy",
    archived: false,
    guardians,
    homes: seed.homeKeys.map((key) => ({
      id: HOMES[key].id,
      label: HOMES[key].label,
      address: HOMES[key].address,
      archived: false,
      guardians: HOMES[key].guardianKeys.map((guardianKey) => ({
        id: GUARDIANS[guardianKey].id,
        name: GUARDIANS[guardianKey].name,
      })),
    })),
    next_session: null,
    levels: Object.entries(seed.levels).map(([name, level]) => ({
      subject_id: getSubject(name).id,
      name,
      level,
    })),
    evaluated: seed.isEvaluated
      ? { at: "2026-09-01T10:00:00", by: { id: "user-maria", name: "Maria Lopez" } }
      : null,
    created_at: seed.createdAt,
  };
}

export const CHILDREN: ChildSummary[] = Object.values(CHILD_SEEDS).map(
  toChildSummary,
);

// Home directions are only on the detail read (HomeRef).
export function getHomeRef(homeId: string): HomeRef | null {
  const seed = Object.values(HOMES).find((home) => home.id === homeId);
  return seed
    ? { id: seed.id, label: seed.label, address: seed.address, directions: seed.directions }
    : null;
}

export function getChildNotes(childId: string): string | null {
  return Object.values(CHILD_SEEDS).find((seed) => seed.id === childId)?.notes ?? null;
}

export function getGuardiansOf(childId: string): BookingDetail["guardians"] {
  const seed = Object.values(CHILD_SEEDS).find((item) => item.id === childId);
  return (seed?.guardianKeys ?? []).map((key) => ({
    id: GUARDIANS[key].id,
    name: GUARDIANS[key].name,
    conversation_id: GUARDIANS[key].conversationId,
  }));
}

type BookingSeed = [
  id: string,
  childKey: string,
  staffKey: string,
  subject: string | null,
  date: string,
  start: string,
  end: string,
  status: BookingStatus,
  homeKey: string | null,
  bookedBy: string | null,
];

// [id, child, staff, subject (null = Evaluation), date, start, end,
//  status, home (null = In office), booking Guardian (null = the office)]
const BOOKING_SEEDS: BookingSeed[] = [
  // Last week
  ["bk-01", "sofia", "ana", "Math", "2026-10-06", "09:30", "10:30", "completed", "martinez-mom", "laura"],
  ["bk-02", "camila", "jordan", "Science", "2026-10-07", "16:30", "17:30", "completed", "reyes", "sandra"],
  ["bk-03", "emma", "marco", "Math", "2026-10-08", "17:00", "18:00", "cancelled", null, "julia"],
  ["bk-04", "isabella", "ana", "Writing", "2026-10-09", "15:30", "16:30", "completed", "gomez", "monica"],
  // This week
  ["bk-10", "lucas", "marco", "Reading", "2026-10-12", "15:00", "16:00", "confirmed", "herrera", "diana"],
  ["bk-11", "valentina", "priya", "Math", "2026-10-12", "16:30", "17:30", "completed", null, null],
  ["bk-12", "mateo", "jordan", "Science", "2026-10-12", "17:30", "18:30", "cancelled", "silva", "andrea"],
  ["bk-13", "gabriel", "daniela", "Reading", "2026-10-12", "16:00", "17:00", "confirmed", "torres", "ricardo"],
  ["bk-20", "sofia", "ana", "Math", "2026-10-13", "09:30", "10:30", "confirmed", "martinez-mom", "laura"],
  ["bk-21", "daniel", "daniela", null, "2026-10-13", "11:30", "13:00", "confirmed", null, null],
  ["bk-22", "isabella", "ana", "Writing", "2026-10-13", "15:30", "16:30", "confirmed", "gomez", "monica"],
  ["bk-23", "santiago", "daniela", "Math", "2026-10-13", "15:00", "16:00", "confirmed", "vega", "mvega"],
  ["bk-24", "emma", "marco", "Math", "2026-10-13", "17:00", "18:00", "confirmed", null, "julia"],
  ["bk-30", "olivia", "jordan", "Reading", "2026-10-14", "10:00", "11:00", "confirmed", null, null],
  ["bk-31", "noah", "maria", null, "2026-10-14", "14:00", "15:30", "confirmed", null, null],
  ["bk-32", "lucas", "sam", "Reading", "2026-10-14", "15:30", "16:30", "confirmed", "herrera", "diana"],
  ["bk-33", "camila", "jordan", "Science", "2026-10-14", "16:30", "17:30", "confirmed", "reyes", "sandra"],
  ["bk-40", "valentina", "priya", "Math", "2026-10-15", "15:00", "16:00", "confirmed", null, "carlos"],
  ["bk-41", "isabella", "lena", "Math", "2026-10-15", "16:00", "17:00", "confirmed", "gomez", null],
  ["bk-42", "gabriel", "daniela", "Reading", "2026-10-15", "16:00", "17:00", "confirmed", "torres", "ricardo"],
  ["bk-43", "sofia", "ana", "Math", "2026-10-15", "17:00", "18:00", "confirmed", "martinez-dad", "jorge"],
  ["bk-50", "mateo", "jordan", "Science", "2026-10-16", "16:00", "17:00", "confirmed", "silva", "andrea"],
  ["bk-51", "emma", "marco", "Math", "2026-10-16", "17:00", "18:00", "confirmed", null, "julia"],
  ["bk-60", "santiago", "ana", "Math", "2026-10-17", "09:00", "10:00", "confirmed", null, "mvega"],
  ["bk-61", "olivia", "ana", "Reading", "2026-10-17", "10:30", "11:30", "confirmed", null, "teresa"],
  // Next week
  ["bk-70", "sofia", "ana", "Math", "2026-10-20", "09:30", "10:30", "confirmed", "martinez-mom", "laura"],
  ["bk-71", "camila", "jordan", "Science", "2026-10-21", "16:30", "17:30", "confirmed", "reyes", "sandra"],
  ["bk-72", "gabriel", "daniela", "Reading", "2026-10-22", "16:00", "17:00", "confirmed", "torres", "ricardo"],
];

// Olivia's Wednesday stays on Jordan's day off on purpose (an Admin kept it).
const ACKNOWLEDGED: Record<string, { by: NamedRef; at: string }> = {
  "bk-30": {
    by: { id: "user-maria", name: "Maria Lopez" },
    at: "2026-10-12T09:10:00",
  },
};

function toBookingDetail(seed: BookingSeed): BookingDetail {
  const [id, childKey, staffKey, subjectName, date, start, end, status, homeKey, bookedBy] = seed;
  const child = CHILD_SEEDS[childKey];
  const subject = subjectName ? getSubject(subjectName) : null;
  const home = homeKey ? HOMES[homeKey] : null;
  const acknowledged = ACKNOWLEDGED[id] ?? null;
  return {
    id,
    child: { id: child.id, name: child.name, notes: child.notes },
    staff: getStaffRef(staffKey),
    kind: subject ? "regular" : "evaluation",
    location: home ? "home" : "in_office",
    subject,
    subject_level: subjectName ? (child.levels[subjectName] ?? null) : null,
    scheduled_date: date,
    start_time: `${start}:00`,
    end_time: `${end}:00`,
    status,
    notes: id === "bk-43" ? "Dad’s weekend: Jorge asked for 5 PM." : null,
    home: home
      ? { id: home.id, label: home.label, address: home.address, directions: home.directions }
      : null,
    booked_by_guardian: bookedBy
      ? { id: GUARDIANS[bookedBy].id, name: GUARDIANS[bookedBy].name }
      : null,
    guardians: getGuardiansOf(child.id),
    // Computed on every read by the store, like the API.
    sort_out_reasons: [],
    clash_acknowledged_by: acknowledged?.by ?? null,
    clash_acknowledged_at: acknowledged?.at ?? null,
    updated_at: "2026-10-10T12:00:00",
  };
}

export const SEED_BOOKINGS: BookingDetail[] = BOOKING_SEEDS.map(toBookingDetail);

// Approved Time off the clash rule reads.
export const APPROVED_TIME_OFF: ExceptionRead[] = [
  {
    id: "timeoff-t5",
    staff: getStaffRef("jordan"),
    start_date: "2026-10-14",
    end_date: "2026-10-14",
    start_time: null,
    end_time: null,
    reason: "Jury duty",
    status: "approved",
    created_at: "2026-10-09T08:00:00",
    decided_by: { id: "user-maria", name: "Maria Lopez" },
    decided_at: "2026-10-11T19:30:00",
    cancelled_by: null,
    cancelled_at: null,
    clashing_bookings: [],
    clashing_bookings_count: 2,
  },
  {
    id: "timeoff-t3",
    staff: getStaffRef("ana"),
    start_date: "2026-11-26",
    end_date: "2026-11-27",
    start_time: null,
    end_time: null,
    reason: "Thanksgiving",
    status: "approved",
    created_at: "2026-10-01T08:00:00",
    decided_by: { id: "user-maria", name: "Maria Lopez" },
    decided_at: "2026-10-02T10:00:00",
    cancelled_by: null,
    cancelled_at: null,
    clashing_bookings: [],
    clashing_bookings_count: 0,
  },
];

type AvailabilityRange = {
  id: string;
  userId: string;
  // 0 = Sunday, like Date#getDay.
  weekday: number;
  from: string;
  to: string;
  mode: "traveler" | "anywhere" | "only_office";
};

// Weekly availability per Tutor and Manager; Admins have none (the bot
// never offers them, the office can still book them).
export const AVAILABILITY: AvailabilityRange[] = [
  ...[1, 2, 3, 4].map((weekday) => ({ id: `av-ana-${weekday}`, userId: "user-ana", weekday, from: "15:00", to: "19:00", mode: "anywhere" as const })),
  { id: "av-ana-2am", userId: "user-ana", weekday: 2, from: "09:00", to: "12:00", mode: "only_office" },
  { id: "av-ana-6", userId: "user-ana", weekday: 6, from: "09:00", to: "13:00", mode: "only_office" },
  ...[1, 2, 4, 5].map((weekday) => ({ id: `av-marco-${weekday}`, userId: "user-marco", weekday, from: "15:00", to: "19:00", mode: "traveler" as const })),
  ...[1, 3, 4].map((weekday) => ({ id: `av-priya-${weekday}`, userId: "user-priya", weekday, from: "14:00", to: "18:00", mode: "anywhere" as const })),
  ...[1, 3, 5].map((weekday) => ({ id: `av-jordan-${weekday}`, userId: "user-jordan", weekday, from: "10:00", to: "18:00", mode: "anywhere" as const })),
  ...[3, 5].map((weekday) => ({ id: `av-sam-${weekday}`, userId: "user-sam", weekday, from: "15:00", to: "18:00", mode: "traveler" as const })),
  ...[1, 2, 4].map((weekday) => ({ id: `av-daniela-${weekday}`, userId: "user-daniela", weekday, from: "15:00", to: "18:00", mode: "anywhere" as const })),
];
