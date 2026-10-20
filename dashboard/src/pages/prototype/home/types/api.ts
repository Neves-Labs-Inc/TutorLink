// Wire shapes Home reads, field-for-field from api/app/schemas/ (PR #224).
// Dates are ISO strings as they arrive over JSON: `date` "2026-10-13",
// `time` "15:00:00", `datetime` with an offset.

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

// GET /api/counts (schemas/counts.py)
export type CountsRead = {
  needs_attention: number;
  // null for a Manager, who has no all-Staff Time off list.
  time_off_pending: number | null;
  children_awaiting_evaluation: number;
  bookings_to_sort_out: number;
  unread_chats: number;
};

export type NamedRef = { id: string; name: string };

export type UserRole = "admin" | "tutor" | "developer" | "manager";

export type StaffRef = { id: string; name: string; role: UserRole };

// GET /api/conversations?flagged=true (schemas/conversation.py)
export type ConversationStatus = "bot" | "human";

export type FlagReason =
  | "stuck"
  | "didnt_understand"
  | "guardian_link_request"
  | "reactivation_request"
  | "booking_request"
  | "question";

export type ConversationSummary = {
  id: string;
  phone_number: string;
  guardian: NamedRef | null;
  status: ConversationStatus;
  taken_over_by: NamedRef | null;
  last_message_at: string;
  last_message_preview: string | null;
  unread: boolean;
  flag_reason: FlagReason | null;
  intake_in_progress: boolean;
};

// GET /api/exceptions?status=pending (schemas/exceptions.py)
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";

export type ExceptionReadStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

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
  status: ExceptionReadStatus;
  created_at: string;
  decided_by: NamedRef | null;
  decided_at: string | null;
  cancelled_by: NamedRef | null;
  cancelled_at: string | null;
  clashing_bookings: ClashingBooking[];
  clashing_bookings_count: number;
};

// GET /api/bookings?from=&to= (schemas/booking.py)
export type BookingKind = "regular" | "evaluation";

export type BookingLocation = "home" | "office";

export type SortOutReason = "not_completed" | "time_off_clash" | "archived_staff";

export type HomeSummaryRef = { id: string; label: string | null; address: string };

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

export type BookingKindCounts = { regular: number; evaluation: number };

// GET /api/children?evaluable=true (schemas/child.py): Children not yet
// Evaluated and with no live Evaluation booked.
export type ChildHomeRef = {
  id: string;
  label: string | null;
  address: string;
  archived: boolean;
  guardians: NamedRef[];
};

export type NextSession = {
  id: string;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  tutor: NamedRef;
  subject: NamedRef | null;
};

export type ChildLevelRef = { subject_id: string; name: string; level: number };

export type EvaluatedRead = { at: string; by: NamedRef };

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
  // PROPOSED (TutorLink#242, API gaps #228). Archiving a Tutor, or
  // making them an Admin, removes them.
  assigned_tutors: StaffRef[];
};

// PROPOSED: a Tutor or Manager who can be assigned, with the Subjects
// they teach (GET /api/staff?assignable=true, or StaffRead plus
// TutorSubjectRead.max_grade_level).
export type AssignableStaff = StaffRef & {
  subjects: { subject_id: string; name: string; max_grade_level: number }[];
};

export type BookingPage = Page<BookingSummary> & {
  counts_by_kind: BookingKindCounts;
};
