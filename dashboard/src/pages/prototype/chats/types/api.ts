// Wire shapes the Chats area reads, copied field-for-field from
// api/app/schemas/{conversation,message,reminder,counts,common}.py and
// the enums in api/app/models/enums.py. Datetimes are ISO strings with
// an offset (AwareDatetime on the API); dates are "YYYY-MM-DD".

export type Uuid = string;
export type IsoDateTime = string;
export type IsoDate = string;

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

// ---- conversations -------------------------------------------------------

export type ConversationStatus = "bot" | "human";

export type FlagReason =
  | "stuck"
  | "didnt_understand"
  | "guardian_link_request"
  | "reactivation_request"
  | "booking_request"
  | "question";

export type Language = "en" | "es";

export type GuardianRef = { id: Uuid; name: string };
export type UserRef = { id: Uuid; name: string };

export type ReactivationChildRef = { id: Uuid; name: string; archived: boolean };
export type ReactivationRequestRead = { child: ReactivationChildRef };

// GET /api/conversations → Page<ConversationSummary>
export type ConversationSummary = {
  id: Uuid;
  phone_number: string;
  guardian: GuardianRef | null;
  status: ConversationStatus;
  taken_over_by: UserRef | null;
  last_message_at: IsoDateTime;
  last_message_preview: string | null;
  unread: boolean;
  flag_reason: FlagReason | null;
  intake_in_progress: boolean;
};

// GET /api/conversations/{id}, and what takeover / transfer / release /
// read / handled / reactivation approve|deny / PATCH all return.
export type ConversationRead = {
  id: Uuid;
  phone_number: string;
  guardian: GuardianRef | null;
  status: ConversationStatus;
  taken_over_by: UserRef | null;
  taken_over_at: IsoDateTime | null;
  last_message_at: IsoDateTime;
  last_read_at: IsoDateTime | null;
  flag_reason: FlagReason | null;
  flagged_at: IsoDateTime | null;
  message_count: number;
  created_at: IsoDateTime;
  reactivation_request: ReactivationRequestRead | null;
  is_window_open: boolean;
  last_client_message_at: IsoDateTime | null;
  language: Language | null;
  intake_in_progress: boolean;
};

// POST /api/conversations/{id}/handled body: a compare token.
export type FlagHandled = { flagged_at: IsoDateTime };

// ---- messages ------------------------------------------------------------

export type MessageAuthor = "client" | "bot" | "admin" | "system";

export type MessageStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "failed";

export type SystemMessageKind =
  | "takeover_notice"
  | "transfer_notice"
  | "handback_notice"
  | "booking_reminder"
  | "consent_notice"
  | "number_change_note"
  | "handoff_note";

// GET /api/conversations/{id}/messages → Page<MessageRead>
export type MessageRead = {
  id: Uuid;
  author_kind: MessageAuthor;
  author: UserRef | null;
  body: string;
  status: MessageStatus;
  created_at: IsoDateTime;
  system_kind: SystemMessageKind | null;
  error_code: string | null;
  reminder_child_names: string[] | null;
};

// ---- reminders -----------------------------------------------------------

export type RemindersState = "on" | "off" | "not_set_up";

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

export type ReminderPreviewItem = {
  guardian_id: Uuid;
  guardian_name: string;
  child_names: string[];
  language: Language;
  skip_reason: ReminderSkipReason | null;
};

export type ReminderRowRead = {
  guardian_id: Uuid;
  guardian_name: string;
  child_names: string[];
  language: Language;
  status: ReminderStatus;
  skip_reason: ReminderSkipReason | null;
  error_code: string | null;
  may_have_been_delivered: boolean;
  sent_at: IsoDateTime | null;
};

// GET /api/reminders/week?week_start=
export type ReminderWeekRead = {
  week_start: IsoDate;
  has_run: boolean;
  preview: ReminderPreviewItem[] | null;
  rows: ReminderRowRead[];
  reminders: RemindersState;
  next_run_at: IsoDateTime | null;
};

// ---- counts --------------------------------------------------------------

// GET /api/counts: every badge in the Office shell.
export type CountsRead = {
  needs_attention: number;
  time_off_pending: number | null;
  children_awaiting_evaluation: number;
  bookings_to_sort_out: number;
  unread_chats: number;
};
