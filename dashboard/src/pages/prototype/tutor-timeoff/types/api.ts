// Wire shapes this area reads and writes, field for field from
// api/app/schemas/ (PR #224). Dates "YYYY-MM-DD", times "HH:MM:SS",
// datetimes ISO strings with an offset, ids UUID-like strings.

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

export type UserRole = "admin" | "tutor" | "developer" | "manager";

// schemas/booking.py
export type NamedRef = { id: string; name: string };
export type StaffRef = { id: string; name: string; role: UserRole };

export type BookingKind = "regular" | "evaluation";
export type BookingLocation = "home" | "in_office";
export type BookingStatus = "pending" | "confirmed" | "cancelled" | "completed";
export type SortOutReason = "not_completed" | "time_off_clash" | "archived_staff";

export type HomeSummaryRef = { id: string; label: string | null; address: string };
export type HomeRef = HomeSummaryRef & { directions: string | null };
export type BookingChild = NamedRef & { notes: string | null };
export type BookingGuardian = {
  id: string;
  name: string;
  conversation_id: string | null;
};

// GET /api/bookings (a Tutor is scoped to their own by TutorScope)
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

// GET /api/bookings/{id}
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

// PATCH /api/bookings/{id} (schemas/booking_status.py). A Tutor may
// only move their own to completed, once it has started.
export type BookingStatusUpdate = {
  status: BookingStatus;
  expected_updated_at: string | null;
};

// schemas/availability.py. day_of_week: 0 = Monday … 6 = Sunday.
export type AvailabilityMode = "traveler" | "anywhere" | "only_office";

export type AvailabilityRead = {
  id: string;
  tutor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  mode: AvailabilityMode;
};

export type AvailabilityCreate = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  mode: AvailabilityMode;
};

export type AvailabilityUpdate = {
  start_time?: string | null;
  end_time?: string | null;
  is_active?: boolean | null;
  mode?: AvailabilityMode | null;
};

// schemas/exceptions.py (Time off)
export type ExceptionReadStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export type TimeOffWarningCode = "booking_clash";

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

// POST /api/users/{user_id}/exceptions
export type ExceptionCreate = {
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
  confirm_warnings: TimeOffWarningCode[];
};

// PATCH /api/exceptions/{id} (Admin roles only)
export type ExceptionDecision = {
  status: "approved" | "rejected";
  confirm_warnings: TimeOffWarningCode[];
};

export type TimeOffWarning = { code: TimeOffWarningCode; message: string };

// The #151 409 body when warnings need confirming.
export type WarningsResponse = { detail: string; warnings: TimeOffWarning[] };

// schemas/staff.py (GET /api/staff?archived=false, the "For" picker)
export type SignInState = "not_invited" | "invited" | "active";

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

// schemas/user.py (GET /api/me)
export type MeRead = {
  id: string;
  email: string;
  role: UserRole;
  name: string;
  tutor_id: string | null;
  office_phone: string | null;
};

// schemas/counts.py (GET /api/counts, Office only; 403 for a Tutor)
export type CountsRead = {
  needs_attention: number;
  time_off_pending: number | null;
  children_awaiting_evaluation: number;
  bookings_to_sort_out: number;
  unread_chats: number;
};
