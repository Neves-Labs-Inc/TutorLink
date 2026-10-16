// The API's wire shapes this prototype reads and writes, field for field
// from api/app/schemas/ (PR #224). Dates are "YYYY-MM-DD", times
// "HH:MM:SS", datetimes ISO strings, ids UUID strings.
export type BookingKind = "regular" | "evaluation";
export type BookingLocation = "home" | "in_office";
// "pending" stays in the enum but every Booking is created Confirmed.
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";
export type UserRole = "admin" | "tutor" | "developer" | "manager";
export type SortOutReason = "not_completed" | "time_off_clash" | "archived_staff";
export type WarningCode = "outside_slot" | "gap" | "time_off" | "grade_ceiling";
export type SignInState = "not_invited" | "invited" | "active";

// schemas/booking.py
export type NamedRef = { id: string; name: string };
export type StaffRef = { id: string; name: string; role: UserRole };
export type BookingChild = NamedRef & { notes: string | null };
export type HomeSummaryRef = { id: string; label: string | null; address: string };
export type HomeRef = HomeSummaryRef & { directions: string | null };
export type BookingGuardian = {
  id: string;
  name: string;
  conversation_id: string | null;
};

export type BookingSummary = {
  id: string;
  child: NamedRef;
  staff: StaffRef;
  kind: BookingKind;
  location: BookingLocation;
  subject: NamedRef | null;
  subject_level: number | null;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  notes: string | null;
  home: HomeSummaryRef | null;
  sort_out_reasons: SortOutReason[];
  clash_acknowledged_by: NamedRef | null;
  clash_acknowledged_at: string | null;
  updated_at: string;
};

export type BookingDetail = {
  id: string;
  child: BookingChild;
  staff: StaffRef;
  kind: BookingKind;
  location: BookingLocation;
  subject: NamedRef | null;
  subject_level: number | null;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  notes: string | null;
  home: HomeRef | null;
  booked_by_guardian: NamedRef | null;
  guardians: BookingGuardian[];
  sort_out_reasons: SortOutReason[];
  clash_acknowledged_by: NamedRef | null;
  clash_acknowledged_at: string | null;
  updated_at: string;
};

export type BookingPage = {
  items: BookingSummary[];
  total: number;
  page: number;
  page_size: number;
  counts_by_kind: { regular: number; evaluation: number };
};

// schemas/booking_write.py: POST /api/bookings and PUT /api/bookings/{id}
export type BookingCreate = {
  user_id: string;
  location: BookingLocation;
  subject_id: string | null;
  availability_id: string | null;
  home_id: string | null;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  confirm_warnings: WarningCode[];
  child_id: string;
  kind: BookingKind;
  booked_by_guardian_id: string | null;
  notes: string | null;
};

export type BookingReplace = Omit<
  BookingCreate,
  "child_id" | "booked_by_guardian_id" | "kind"
> & { kind?: BookingKind };

export type BookingWarning = { code: WarningCode; message: string };

// The 409 body when warnings need confirming.
export type WarningRefusal = { detail: string; warnings: BookingWarning[] };

// schemas/slot.py: GET /api/slots/available
export type SlotRead = {
  tutor_id: string;
  tutor_name: string;
  availability_id: string;
  date: string;
  start_time: string;
  end_time: string;
};

// schemas/exceptions.py: a Time off as Office reads it.
export type ClashingBooking = {
  booking_id: string;
  date: string;
  start_time: string;
  end_time: string;
  child_name: string;
  status: BookingStatus;
};

export type ExceptionRead = {
  id: string;
  staff: StaffRef;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  created_at: string;
  decided_by: NamedRef | null;
  decided_at: string | null;
  cancelled_by: NamedRef | null;
  cancelled_at: string | null;
  clashing_bookings: ClashingBooking[];
  clashing_bookings_count: number;
};

// schemas/staff.py: GET /api/staff?archived=false feeds the Staff picker.
export type StaffRead = {
  id: string;
  name: string;
  role: UserRole;
  tutor_id: string | null;
  email: string;
  sign_in_state: SignInState;
  invite_expires_at: string | null;
  archived: boolean;
  subjects: NamedRef[];
  sessions_this_week: number;
};

// schemas/child.py: GET /api/children?evaluable=true is "Evaluations to
// book"; the form's Child picker reads the same list shape.
export type ChildSummary = {
  id: string;
  name: string;
  grade_level: number | null;
  school_name: string;
  archived: boolean;
  guardians: NamedRef[];
  homes: {
    id: string;
    label: string | null;
    address: string;
    archived: boolean;
    guardians: NamedRef[];
  }[];
  next_session: {
    id: string;
    scheduled_date: string;
    start_time: string;
    end_time: string;
    tutor: NamedRef;
    subject: NamedRef | null;
  } | null;
  levels: { subject_id: string; name: string; level: number }[];
  evaluated: { at: string; by: NamedRef } | null;
  created_at: string;
  // PROPOSED (TutorLink#242, API gaps #228): the Child's Assigned Tutors.
  // Archiving a Tutor removes them.
  assigned_tutors: StaffRef[];
};

// schemas/counts.py: GET /api/counts, the nav badges.
export type CountsRead = {
  needs_attention: number;
  time_off_pending: number | null;
  children_awaiting_evaluation: number;
  bookings_to_sort_out: number;
  unread_chats: number;
};
