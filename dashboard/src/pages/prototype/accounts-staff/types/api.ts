// Wire shapes from api/app/schemas/ (PR #224), field for field. Dates
// are ISO strings, times "HH:MM:SS", ids plain strings.

export type Language = "en" | "es";
export type RemindersWire = "opt_in" | "opt_out" | "never";
export type UserRole = "admin" | "tutor" | "manager" | "developer";
export type SignInStateWire = "not_invited" | "invited" | "active";
export type BookingKindWire = "regular" | "evaluation";
export type BookingLocationWire = "home" | "in_office";
export type BookingStatusWire =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled";
export type AvailabilityMode = "traveler" | "anywhere" | "only_office";
export type ExceptionReadStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export type NamedRef = { id: string; name: string };
export type StaffRef = { id: string; name: string; role: UserRole };

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

// schemas/counts.py
export type CountsRead = {
  needs_attention: number;
  time_off_pending: number | null;
  children_awaiting_evaluation: number;
  bookings_to_sort_out: number;
  unread_chats: number;
};

// schemas/child.py
export type EvaluatedRead = { at: string; by: NamedRef };

export type ChildLevelRef = { subject_id: string; name: string; level: number };

export type ChildLevelRead = {
  subject_id: string;
  name: string;
  archived: boolean;
  level: number;
  set_by: NamedRef;
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
  subject: NamedRef | null;
};

export type ChildSummary = {
  id: string;
  name: string;
  grade_level: number | null;
  school_name: string;
  archived: boolean;
  guardians: NamedRef[];
  homes: ChildHomeRef[];
  next_session: NextSession | null;
  levels: ChildLevelRef[];
  evaluated: EvaluatedRead | null;
  created_at: string;
};

export type ChildGuardianRead = {
  id: string;
  name: string;
  phone_number: string;
  archived: boolean;
  language: Language;
  reminders: RemindersWire;
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
};

// schemas/client.py (a Guardian is a "client" on the wire)
export type HomeRead = {
  id: string;
  label: string | null;
  address: string;
  directions: string | null;
  archived: boolean;
  guardians: NamedRef[];
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
  reminders: RemindersWire;
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
  language: Language | null;
  language_conversation_id: string | null;
};

// schemas/household.py: GET /api/households. A household is computed
// per request (connected Guardians and Children over child_guardians);
// `key` is the first Guardian's id, a render key only.
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

export type HouseholdRead = {
  key: string;
  guardians: HouseholdGuardian[];
  children: HouseholdChild[];
};

// schemas/home.py
export type ClientHomeCreate = {
  label: string | null;
  address: string;
  directions: string | null;
};

// schemas/staff.py
export type StaffRead = {
  id: string;
  name: string;
  role: UserRole;
  tutor_id: string | null;
  email: string;
  sign_in_state: SignInStateWire;
  invite_expires_at: string | null;
  archived: boolean;
  subjects: NamedRef[];
  sessions_this_week: number;
};

// schemas/tutor.py
export type TutorSubjectRead = {
  subject_id: string;
  name: string;
  max_grade_level: number;
};

export type TutorRead = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  phone_number: string;
  bio: string | null;
  archived: boolean;
  subjects: TutorSubjectRead[];
};

// schemas/user.py
export type UserCreate = {
  email: string;
  name: string;
  role: UserRole;
  tutor_id?: string | null;
  tutor?: { phone_number: string; bio: string | null } | null;
};

// schemas/availability.py. day_of_week 0 = Monday.
export type AvailabilityRead = {
  id: string;
  tutor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  mode: AvailabilityMode;
};

// schemas/exceptions.py (Time off)
export type ClashingBooking = {
  booking_id: string;
  date: string;
  start_time: string;
  end_time: string;
  child_name: string;
  status: BookingStatusWire;
};

export type ExceptionRead = {
  id: string;
  staff: StaffRef;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  status: ExceptionReadStatus;
  created_at: string;
  decided_by: NamedRef | null;
  decided_at: string | null;
  cancelled_by: NamedRef | null;
  cancelled_at: string | null;
  clashing_bookings: ClashingBooking[];
  clashing_bookings_count: number;
};

// schemas/booking.py (BookingSummary, the fields the Bookings tab reads
// plus the rest so the shape stays honest)
export type BookingSummary = {
  id: string;
  child: NamedRef;
  staff: StaffRef;
  kind: BookingKindWire;
  location: BookingLocationWire;
  subject: NamedRef | null;
  subject_level: number | null;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  status: BookingStatusWire;
  notes: string | null;
  home: { id: string; label: string | null; address: string } | null;
  sort_out_reasons: string[];
  clash_acknowledged_by: NamedRef | null;
  clash_acknowledged_at: string | null;
  updated_at: string;
};

// schemas/archive.py
export type ArchiveRead = {
  type: string;
  id: string;
  archived: boolean;
  cancelled_booking_ids: string[];
};
