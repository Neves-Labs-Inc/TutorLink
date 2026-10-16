// In-memory sample data for a Doral tutoring business. Prototype only.
import type {
  AttentionReason,
  AvailabilitySlot,
  BookingKind,
  BookingStatus,
  RemindersState,
  Role,
  SignInState,
  SlotLocation,
  TimeOffStatus,
} from "@/components/kit/types/domain";

// The kit owns the domain words; re-exported so prototypes keep one import.
export type {
  AttentionReason,
  AvailabilitySlot,
  BookingKind,
  BookingStatus,
  RemindersState,
  Role,
  SignInState,
  SlotLocation,
  TimeOffStatus,
};
export type StaffRole = "Admin" | "Manager" | "Tutor";

export type Booking = {
  id: string;
  kind: BookingKind;
  status: BookingStatus;
  child: string;
  childNotes?: string;
  guardian: string;
  staff: string;
  subject: string;
  level: string;
  start: string;
  durationMin: number;
  location: string;
  directions?: string;
};

export type Staff = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  signIn: SignInState;
  subjects: string[];
  sessionsThisWeek: number;
  isArchived: boolean;
};

export type Home = {
  id: string;
  guardianId: string;
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  directions: string;
  isArchived: boolean;
};

export type Guardian = {
  id: string;
  name: string;
  phone: string;
  language: "English" | "Spanish";
  children: string[];
  reminders: RemindersState;
};

export type Child = {
  id: string;
  name: string;
  guardian: string;
  overallGrade: string;
  isEvaluated: boolean;
  subjects: string[];
};

export type Conversation = {
  id: string;
  guardian: string;
  preview: string;
  at: string;
  unread: boolean;
  handler: "Bot" | string;
  attention: AttentionReason | null;
};

export type TimeOffTiming = "upcoming" | "past";

export type TimeOff = {
  id: string;
  staff: string;
  staffRole: StaffRole;
  range: string;
  reason: string;
  status: TimeOffStatus;
  timing: TimeOffTiming;
};

export const TODAY = "2026-10-13";
export const NOW = "2026-10-13T08:40:00";

export const CURRENT_USER: Record<
  Role,
  { name: string; first: string; role: StaffRole }
> = {
  admin: { name: "Maria Lopez", first: "Maria", role: "Admin" },
  manager: { name: "Daniela Cruz", first: "Daniela", role: "Manager" },
  tutor: { name: "Ana Ruiz", first: "Ana", role: "Tutor" },
};

export const BOOKINGS: Booking[] = [
  { id: "b01", kind: "Tutoring", status: "Confirmed", child: "Lucas Herrera", guardian: "Diana Herrera", staff: "Marco Diaz", subject: "Reading", level: "Grade 2", start: "2026-10-12T15:00:00", durationMin: 60, location: "8450 NW 53rd St, Doral, FL 33166" },
  { id: "b02", kind: "Evaluation", status: "Completed", child: "Valentina Rojas", guardian: "Carlos Rojas", staff: "Priya Patel", subject: "Math", level: "Grade 5", start: "2026-10-12T16:30:00", durationMin: 90, location: "In office" },
  { id: "b03", kind: "Tutoring", status: "Cancelled", child: "Mateo Silva", guardian: "Andrea Silva", staff: "Jordan Blake", subject: "Science", level: "Grade 6", start: "2026-10-12T17:30:00", durationMin: 60, location: "10200 NW 41st St, Doral, FL 33178" },
  { id: "b04", kind: "Tutoring", status: "Confirmed", child: "Sofia Martinez", childNotes: "Gets anxious with fractions; likes drawing.", guardian: "Laura Martinez", staff: "Ana Ruiz", subject: "Math", level: "Grade 4", start: "2026-10-13T09:30:00", durationMin: 60, location: "5600 NW 105th Ct, Doral, FL 33178", directions: "Gate code 4512, blue door on the left." },
  { id: "b05", kind: "Evaluation", status: "Confirmed", child: "Daniel Ortiz", childNotes: "First evaluation; shy at first, warms up with games.", guardian: "Patricia Ortiz", staff: "Ana Ruiz", subject: "Reading", level: "Grade 3", start: "2026-10-13T11:30:00", durationMin: 90, location: "In office" },
  { id: "b06", kind: "Tutoring", status: "Confirmed", child: "Isabella Gomez", childNotes: "Needs frequent short breaks.", guardian: "Monica Gomez", staff: "Ana Ruiz", subject: "Writing", level: "Grade 5", start: "2026-10-13T15:30:00", durationMin: 60, location: "3300 NW 87th Ave, Doral, FL 33172", directions: "Visitor parking, apartment 4B, call on arrival." },
  { id: "b07", kind: "Tutoring", status: "Pending", child: "Gabriel Torres", guardian: "Ricardo Torres", staff: "Daniela Cruz", subject: "Reading", level: "Grade 2", start: "2026-10-13T16:00:00", durationMin: 60, location: "8700 NW 36th St, Doral, FL 33166", directions: "Ring the bell twice, the dog is friendly." },
  { id: "b08", kind: "Tutoring", status: "Confirmed", child: "Emma Castillo", guardian: "Julia Castillo", staff: "Marco Diaz", subject: "Math", level: "Grade 3", start: "2026-10-13T17:00:00", durationMin: 60, location: "In office" },
  { id: "b09", kind: "Evaluation", status: "Pending", child: "Noah Fernandez", guardian: "Elena Fernandez", staff: "Priya Patel", subject: "Math", level: "Grade 6", start: "2026-10-14T14:00:00", durationMin: 90, location: "In office" },
  { id: "b10", kind: "Tutoring", status: "Confirmed", child: "Camila Reyes", guardian: "Sandra Reyes", staff: "Jordan Blake", subject: "Science", level: "Grade 7", start: "2026-10-14T16:30:00", durationMin: 60, location: "11010 NW 58th St, Doral, FL 33178" },
  { id: "b11", kind: "Tutoring", status: "Confirmed", child: "Santiago Vega", guardian: "Maria Vega", staff: "Daniela Cruz", subject: "Math", level: "Grade 5", start: "2026-10-15T15:00:00", durationMin: 60, location: "9100 NW 25th St, Doral, FL 33172" },
  { id: "b12", kind: "Tutoring", status: "Confirmed", child: "Sofia Martinez", guardian: "Laura Martinez", staff: "Ana Ruiz", subject: "Math", level: "Grade 4", start: "2026-10-15T17:00:00", durationMin: 60, location: "5600 NW 105th Ct, Doral, FL 33178", directions: "Gate code 4512, blue door on the left." },
  { id: "b13", kind: "Evaluation", status: "Confirmed", child: "Olivia Mendez", guardian: "Teresa Mendez", staff: "Jordan Blake", subject: "Reading", level: "Grade 1", start: "2026-10-16T10:00:00", durationMin: 90, location: "In office" },
  { id: "b14", kind: "Tutoring", status: "Confirmed", child: "Lucas Herrera", guardian: "Diana Herrera", staff: "Sam Okafor", subject: "Reading", level: "Grade 2", start: "2026-10-16T15:30:00", durationMin: 60, location: "8450 NW 53rd St, Doral, FL 33166" },
];

export const STAFF: Staff[] = [
  { id: "s1", name: "Maria Lopez", email: "maria@mshelpinghands.com", role: "Admin", signIn: "Active", subjects: ["Math", "Reading"], sessionsThisWeek: 2, isArchived: false },
  { id: "s2", name: "Daniela Cruz", email: "daniela@mshelpinghands.com", role: "Manager", signIn: "Active", subjects: ["Reading", "Writing"], sessionsThisWeek: 6, isArchived: false },
  { id: "s3", name: "Ana Ruiz", email: "ana.ruiz@gmail.com", role: "Tutor", signIn: "Active", subjects: ["Math", "Reading", "Writing"], sessionsThisWeek: 11, isArchived: false },
  { id: "s4", name: "Marco Diaz", email: "marco.diaz@outlook.com", role: "Tutor", signIn: "Active", subjects: ["Math", "Reading"], sessionsThisWeek: 8, isArchived: false },
  { id: "s5", name: "Priya Patel", email: "priya.p@gmail.com", role: "Tutor", signIn: "Invited", subjects: ["Math", "Science"], sessionsThisWeek: 4, isArchived: false },
  { id: "s6", name: "Jordan Blake", email: "jblake@gmail.com", role: "Tutor", signIn: "Active", subjects: ["Science", "Reading"], sessionsThisWeek: 5, isArchived: false },
  { id: "s7", name: "Sam Okafor", email: "", role: "Tutor", signIn: "Not invited", subjects: ["Reading"], sessionsThisWeek: 1, isArchived: false },
  { id: "s8", name: "Lena Brooks", email: "lena.brooks@gmail.com", role: "Tutor", signIn: "Active", subjects: ["Writing"], sessionsThisWeek: 0, isArchived: true },
];

export const GUARDIANS: Guardian[] = [
  { id: "g1", name: "Laura Martinez", phone: "+1 305 555 0142", language: "Spanish", children: ["Sofia Martinez"], reminders: "Reminders on" },
  { id: "g2", name: "Patricia Ortiz", phone: "+1 786 555 0198", language: "English", children: ["Daniel Ortiz"], reminders: "Never asked" },
  { id: "g3", name: "Monica Gomez", phone: "+1 305 555 0117", language: "Spanish", children: ["Isabella Gomez", "Tomas Gomez"], reminders: "Reminders on" },
  { id: "g4", name: "Ricardo Torres", phone: "+1 786 555 0163", language: "Spanish", children: ["Gabriel Torres"], reminders: "Reminders off" },
  { id: "g5", name: "Julia Castillo", phone: "+1 305 555 0189", language: "English", children: ["Emma Castillo"], reminders: "Reminders on" },
  { id: "g7", name: "Jorge Martinez", phone: "+1 305 555 0177", language: "English", children: ["Sofia Martinez"], reminders: "Reminders off" },
  { id: "g8", name: "Rosa Sanchez", phone: "+1 786 555 0131", language: "Spanish", children: ["Leo Sanchez"], reminders: "Never asked" },
  { id: "g6", name: "Elena Fernandez", phone: "+1 954 555 0124", language: "Spanish", children: ["Noah Fernandez"], reminders: "Never asked" },
];

export const CHILDREN: Child[] = [
  { id: "c1", name: "Sofia Martinez", guardian: "Laura Martinez", overallGrade: "Grade 4", isEvaluated: true, subjects: ["Math"] },
  { id: "c2", name: "Daniel Ortiz", guardian: "Patricia Ortiz", overallGrade: "Grade 3", isEvaluated: false, subjects: ["Reading"] },
  { id: "c3", name: "Isabella Gomez", guardian: "Monica Gomez", overallGrade: "Grade 5", isEvaluated: true, subjects: ["Writing", "Math"] },
  { id: "c4", name: "Tomas Gomez", guardian: "Monica Gomez", overallGrade: "Grade 1", isEvaluated: false, subjects: [] },
  { id: "c5", name: "Gabriel Torres", guardian: "Ricardo Torres", overallGrade: "Grade 2", isEvaluated: true, subjects: ["Reading"] },
  { id: "c6", name: "Noah Fernandez", guardian: "Elena Fernandez", overallGrade: "Grade 6", isEvaluated: false, subjects: ["Math"] },
  { id: "c7", name: "Leo Sanchez", guardian: "Rosa Sanchez", overallGrade: "Grade 3", isEvaluated: false, subjects: [] },
];

export const CONVERSATIONS: Conversation[] = [
  { id: "ch1", guardian: "Laura Martinez", preview: "¿Podemos mover la sesión del jueves a las 6?", at: "8:31 AM", unread: true, handler: "Bot", attention: "Wants to book" },
  { id: "ch2", guardian: "Carlos Rojas", preview: "What did the evaluation show for Valentina?", at: "8:02 AM", unread: true, handler: "Bot", attention: "Has a question" },
  { id: "ch3", guardian: "Patricia Ortiz", preview: "Thanks! See you at 11:30.", at: "Yesterday", unread: false, handler: "Maria Lopez", attention: null },
  { id: "ch4", guardian: "Sandra Reyes", preview: "I sent a photo of the homework", at: "Yesterday", unread: false, handler: "Bot", attention: "Bot didn't understand" },
  { id: "ch6", guardian: "Andrea Silva", preview: "Can I add my son Diego to my account?", at: "7:15 AM", unread: false, handler: "Bot", attention: "Link request" },
  { id: "ch5", guardian: "Ricardo Torres", preview: "Ok, perfecto. Gracias.", at: "Mon", unread: false, handler: "Bot", attention: null },
];

export const TIME_OFF: TimeOff[] = [
  { id: "t1", staff: "Marco Diaz", staffRole: "Tutor", range: "Oct 20 – 22", reason: "Family trip", status: "Pending", timing: "upcoming" },
  { id: "t2", staff: "Daniela Cruz", staffRole: "Manager", range: "Oct 24, 1 – 5 PM", reason: "Doctor’s appointment", status: "Pending", timing: "upcoming" },
  { id: "t6", staff: "Priya Patel", staffRole: "Tutor", range: "Oct 30", reason: "Graduation ceremony", status: "Pending", timing: "upcoming" },
  { id: "t7", staff: "Sam Okafor", staffRole: "Tutor", range: "Nov 2 – 6", reason: "Moving house", status: "Pending", timing: "upcoming" },
  { id: "t5", staff: "Jordan Blake", staffRole: "Tutor", range: "Oct 14", reason: "Jury duty", status: "Approved", timing: "upcoming" },
  { id: "t3", staff: "Ana Ruiz", staffRole: "Tutor", range: "Nov 26 – 27", reason: "Thanksgiving", status: "Approved", timing: "upcoming" },
  { id: "t8", staff: "Maria Lopez", staffRole: "Admin", range: "Dec 22 – Jan 2", reason: "Holidays", status: "Approved", timing: "upcoming" },
  { id: "t9", staff: "Daniela Cruz", staffRole: "Manager", range: "Sep 18", reason: "Family event", status: "Approved", timing: "past" },
  { id: "t4", staff: "Ana Ruiz", staffRole: "Tutor", range: "Oct 3", reason: "Car in the shop", status: "Declined", timing: "past" },
  { id: "t10", staff: "Marco Diaz", staffRole: "Tutor", range: "Sep 8 – 9", reason: "Sick", status: "Approved", timing: "past" },
];

export const PENDING_TIME_OFF = TIME_OFF.filter((item) => item.status === "Pending");

export type TodoKind = "chat" | "evaluation" | "booking" | "time-off";

export type TodoItem = {
  id: string;
  kind: TodoKind;
  title: string;
  detail: string;
  // What the row opens: a Conversation, Child, Booking or TimeOff id.
  refId: string;
};

// Home's To do queue (TutorLink#189). Managers only get chats and
// evaluations; time off is Admin-only.
export const TODO_ITEMS: TodoItem[] = [
  { id: "td1", kind: "chat", title: "Laura Martinez", detail: "Wants to book · “¿Podemos mover la sesión del jueves?”", refId: "ch1" },
  { id: "td2", kind: "chat", title: "Carlos Rojas", detail: "Has a question · about Valentina’s evaluation", refId: "ch2" },
  { id: "td3", kind: "chat", title: "Sandra Reyes", detail: "Bot didn’t understand · sent a photo", refId: "ch4" },
  { id: "td10", kind: "chat", title: "Andrea Silva", detail: "Link request · wants to add a second Child", refId: "ch6" },
  { id: "td4", kind: "evaluation", title: "Tomas Gomez", detail: "Grade 1 · no Evaluation session booked yet", refId: "c4" },
  { id: "td5", kind: "evaluation", title: "Leo Sanchez", detail: "Grade 3 · new Account from Intake yesterday", refId: "c7" },
  { id: "td6", kind: "booking", title: "Lucas Herrera · Mon 3:00 PM", detail: "Not marked Completed", refId: "b01" },
  { id: "td7", kind: "booking", title: "Camila Reyes · Wed 4:30 PM", detail: "Jordan Blake has approved Time off that day", refId: "b10" },
  ...PENDING_TIME_OFF.map((item) => ({
    id: `td-${item.id}`,
    kind: "time-off" as const,
    title: item.staffRole === "Tutor" ? item.staff : `${item.staff} (${item.staffRole})`,
    detail: `${item.range} · ${item.reason}`,
    refId: item.id,
  })),
];

// Home's To do (Franklin, 2026-10-13): Admins get Chats and Time off,
// Managers just Chats. Evaluations and Bookings moved to the Bookings
// page's "To sort out" banner (getBookingAttentionFor).
const TODO_KINDS: Record<Role, TodoKind[]> = {
  admin: ["chat", "time-off"],
  manager: ["chat"],
  tutor: [],
};

export function getTodoFor(role: Role): TodoItem[] {
  return TODO_ITEMS.filter((item) => TODO_KINDS[role].includes(item.kind));
}

// Bookings ▸ To sort out: Evaluations to book, and Bookings that are
// unmarked or clash with time off. A Manager sees Evaluations plus only
// their own Bookings.
export function getBookingAttentionFor(role: Role): TodoItem[] {
  const ownName = CURRENT_USER[role].name;
  return TODO_ITEMS.filter((item) => {
    if (item.kind === "evaluation") return role !== "tutor";
    if (item.kind !== "booking") return false;
    const booking = BOOKINGS.find((entry) => entry.id === item.refId);
    return role === "admin" || booking?.staff === ownName;
  });
}

// Times are 24h "HH:MM" so they round-trip through <input type="time">.
export const AVAILABILITY: AvailabilitySlot[] = [
  { id: "a1", day: "Monday", from: "15:00", to: "19:00", location: "Home visits" },
  { id: "a2", day: "Tuesday", from: "09:00", to: "12:00", location: "Office only" },
  { id: "a3", day: "Tuesday", from: "15:00", to: "19:00", location: "Home or office" },
  { id: "a4", day: "Wednesday", from: "15:00", to: "18:00", location: "Home visits" },
  { id: "a5", day: "Thursday", from: "15:00", to: "19:00", location: "Home or office" },
  { id: "a6", day: "Saturday", from: "09:00", to: "13:00", location: "Office only" },
];

export const MANAGER_AVAILABILITY: AvailabilitySlot[] = [
  { id: "m1", day: "Tuesday", from: "15:00", to: "18:00", location: "Home or office" },
  { id: "m2", day: "Thursday", from: "14:00", to: "17:00", location: "Home visits" },
];

export const HOMES: Home[] = [
  { id: "h1", guardianId: "g1", street: "5600 NW 105th Ct", unit: "", city: "Doral", state: "FL", zip: "33178", directions: "Gate code 4512, blue door on the left.", isArchived: false },
  { id: "h2", guardianId: "g7", street: "9821 NW 41st St", unit: "Apt 12", city: "Doral", state: "FL", zip: "33178", directions: "Every other weekend Sofia stays here.", isArchived: false },
  { id: "h3", guardianId: "g1", street: "4300 NW 79th Ave", unit: "", city: "Doral", state: "FL", zip: "33166", directions: "", isArchived: true },
  { id: "h4", guardianId: "g2", street: "7701 NW 107th Ave", unit: "Unit 3", city: "Doral", state: "FL", zip: "33178", directions: "", isArchived: false },
  { id: "h5", guardianId: "g3", street: "3300 NW 87th Ave", unit: "Apt 4B", city: "Doral", state: "FL", zip: "33172", directions: "Visitor parking, call on arrival.", isArchived: false },
  { id: "h6", guardianId: "g4", street: "8700 NW 36th St", unit: "", city: "Doral", state: "FL", zip: "33166", directions: "Ring the bell twice, the dog is friendly.", isArchived: false },
  { id: "h7", guardianId: "g5", street: "10550 NW 66th St", unit: "", city: "Doral", state: "FL", zip: "33178", directions: "", isArchived: false },
  { id: "h8", guardianId: "g6", street: "5250 NW 109th Ave", unit: "Apt 210", city: "Doral", state: "FL", zip: "33178", directions: "", isArchived: false },
];

export function formatAddress(home: Home): string {
  const street = home.unit ? `${home.street}, ${home.unit}` : home.street;
  return `${street}, ${home.city}, ${home.state} ${home.zip}`;
}

export function getGuardiansOf(childName: string): Guardian[] {
  return GUARDIANS.filter((guardian) => guardian.children.includes(childName));
}

export const SUBJECTS = ["Math", "Reading", "Writing", "Science"];

export const CHATS_UNREAD = CONVERSATIONS.filter((chat) => chat.unread).length;

export function getSessionsFor(name: string): Booking[] {
  return BOOKINGS.filter((booking) => booking.staff === name).sort((a, b) =>
    a.start.localeCompare(b.start),
  );
}
