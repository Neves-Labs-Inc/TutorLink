// Wire shapes the Families area reads and writes, typed from
// api/app/schemas/ (household, child, client, home, archive, staff,
// reminder, subject). Dates are ISO strings: `date` "2026-10-20",
// `time` "15:30:00", `datetime` with an offset. Records carry
// `archived`, never the old active flag.

export type NamedRef = { id: string; name: string };

export type UserRole = "admin" | "tutor" | "developer" | "manager";
export type Language = "en" | "es";
export type RemindersConsent = "opt_in" | "opt_out" | "never";
export type ConsentAction = "opt_in" | "opt_out";
export type ConsentSource = "intake" | "message" | "staff" | "system";
export type BookingKind = "regular" | "evaluation";
export type BookingLocation = "home" | "in_office";

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

// schemas/household.py
export type HouseholdGuardian = {
  id: string;
  name: string;
  phone_number: string;
  archived: boolean;
};

export type HouseholdChild = {
  id: string;
  name: string;
  grade_level: number | null;
  archived: boolean;
};

export type HouseholdHome = {
  id: string;
  label: string | null;
  address: string;
  directions: string | null;
  archived: boolean;
  // The family's Guardians on this Home, archived ones included.
  guardian_ids: string[];
};

export type HouseholdNextBooking = {
  id: string;
  kind: BookingKind;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  location: BookingLocation;
  child: NamedRef;
  staff: NamedRef;
};

export type HouseholdRead = {
  key: string;
  guardians: HouseholdGuardian[];
  children: HouseholdChild[];
  name: string;
  // True when every Guardian is archived.
  archived: boolean;
  homes: HouseholdHome[];
  next_booking: HouseholdNextBooking | null;
};

export type HouseholdListParams = {
  q?: string;
  include_archived?: boolean;
  page?: number;
  page_size?: number;
};

// schemas/child.py
export type StaffRef = { id: string; name: string };

export type EvaluatedRead = { at: string; by: StaffRef };

export type ChildRead = {
  id: string;
  name: string;
  date_of_birth: string | null;
  grade_level: number | null;
  school_name: string;
  notes: string | null;
  archived: boolean;
  guardian_ids: string[];
};

export type ChildCreate = {
  guardian_ids: string[];
  name: string;
  date_of_birth: string;
  grade_level?: number | null;
  school_name: string;
  notes?: string | null;
};

// An absent `guardian_ids` leaves the links alone; present, it replaces them.
export type ChildUpdate = {
  guardian_ids?: string[];
  name?: string;
  date_of_birth?: string;
  grade_level?: number;
  school_name?: string;
  notes?: string | null;
};

export type ChildLevelRead = {
  subject_id: string;
  name: string;
  // The Subject's flag: a level outlives its Subject's archive.
  archived: boolean;
  level: number;
  set_by: StaffRef;
  updated_at: string;
};

export type ChildHomeRef = {
  id: string;
  label: string | null;
  address: string;
  archived: boolean;
  guardians: NamedRef[];
};

export type ChildHomeRead = ChildHomeRef & { directions: string | null };

export type NextSession = {
  id: string;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  tutor: NamedRef;
  // Null on an Evaluation.
  subject: NamedRef | null;
};

// Always an active Tutor or Manager, so no `archived`.
export type AssignedTutorRead = { id: string; name: string; role: UserRole };

export type ChildGuardianRead = {
  id: string;
  name: string;
  phone_number: string;
  archived: boolean;
  language: Language;
  reminders: RemindersConsent;
  reminders_blocked_by_whatsapp: boolean;
};

export type ChildDetail = {
  id: string;
  name: string;
  date_of_birth: string | null;
  grade_level: number | null;
  school_name: string;
  notes: string | null;
  archived: boolean;
  upcoming_session_count: number;
  next_session: NextSession | null;
  guardians: ChildGuardianRead[];
  homes: ChildHomeRead[];
  levels: ChildLevelRead[];
  evaluated: EvaluatedRead | null;
  assigned_tutors: AssignedTutorRead[];
  // Prefills Mark Evaluated; null with no live Evaluation or an unassignable runner.
  evaluation_run_by: AssignedTutorRead | null;
};

// schemas/client.py
export type HomeRead = {
  id: string;
  label: string | null;
  address: string;
  directions: string | null;
  archived: boolean;
  guardians: NamedRef[];
  // The upcoming live Bookings that block archiving the Home.
  upcoming_booking_count: number;
};

export type ClientChildRead = {
  id: string;
  name: string;
  date_of_birth: string | null;
  grade_level: number | null;
  school_name: string;
  notes: string | null;
  archived: boolean;
  evaluated: EvaluatedRead | null;
};

export type ClientSummary = {
  id: string;
  name: string;
  phone_number: string;
  archived: boolean;
  home_count: number;
  child_count: number;
  language: Language;
  reminders: RemindersConsent;
  reminders_blocked_by_whatsapp: boolean;
  children: NamedRef[];
};

export type ClientRead = {
  id: string;
  name: string;
  phone_number: string;
  archived: boolean;
  homes: HomeRead[];
  children: ClientChildRead[];
  // Null when not detected (English is used).
  language: Language | null;
  // Null with no conversation: the language can't be changed yet.
  language_conversation_id: string | null;
  reminders: RemindersConsent;
  reminders_blocked_by_whatsapp: boolean;
};

export type HomeCreate = {
  label?: string | null;
  address: string;
  directions?: string | null;
};

export type ClientCreate = {
  name: string;
  phone_number: string;
  home?: HomeCreate | null;
  child_ids?: string[];
  home_ids?: string[];
};

export type ClientUpdate = { name?: string; phone_number?: string };

// schemas/home.py
export type SharedHomeCreate = HomeCreate & { guardian_ids: string[] };

export type HomeUpdate = {
  label?: string | null;
  address?: string;
  directions?: string | null;
};

// schemas/archive.py
export type ArchiveTarget =
  | { type: "child"; id: string; expected_cancellations?: number }
  | { type: "guardian"; id: string; expected_cancellations?: number }
  | { type: "home"; id: string };

export type ArchiveRead = {
  type: string;
  id: string;
  archived: boolean;
  cancelled_booking_ids: string[];
  // Children a Guardian's archive took with it.
  archived_child_ids: string[];
};

// schemas/staff.py
export type SignInState = "not_invited" | "invited" | "active";

export type StaffSubjectRead = {
  id: string;
  name: string;
  max_grade_level: number;
};

export type StaffRead = {
  id: string;
  name: string;
  role: UserRole;
  tutor_id: string | null;
  email: string;
  sign_in_state: SignInState;
  invite_expires_at: string | null;
  archived: boolean;
  subjects: StaffSubjectRead[];
  sessions_this_week: number;
  assigned_children: NamedRef[];
  phone_number: string | null;
  bio: string | null;
  has_pending_time_off: boolean;
};

// schemas/subject.py
export type SubjectRead = {
  id: string;
  name: string;
  name_es: string | null;
  description: string | null;
  archived: boolean;
  tutor_count: number;
};

// schemas/reminder.py
export type ConsentRead = {
  state: RemindersConsent;
  source: ConsentSource | null;
  set_at: string | null;
  blocked_by_whatsapp: boolean;
};

export type ReminderStatus =
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "undeliverable"
  | "skipped";

export type ReminderSkipReason =
  | "blocked_by_whatsapp"
  | "takeover"
  | "template_not_approved";

export type LastReminderRead = {
  week_start: string;
  status: ReminderStatus;
  error_code: string | null;
  skip_reason: ReminderSkipReason | null;
};

export type ConsentHistoryRead = {
  id: string;
  action: ConsentAction;
  source: ConsentSource;
  created_at: string;
  // Staff Display name, "Guardian" or "WhatsApp".
  who: string;
};

export type GuardianRemindersRead = {
  consent: ConsentRead;
  last_reminder: LastReminderRead | null;
  history: ConsentHistoryRead[];
};
