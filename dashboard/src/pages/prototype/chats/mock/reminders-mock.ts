// Booking reminder weeks in the GET /api/reminders/week shape. A week is
// the one the reminder is about: the Sunday 5 PM run before it sends.
// So week 19 Oct is the coming run (Sun 18 Oct), 12 Oct already ran.
import type {
  RemindersState,
  ReminderWeekRead,
} from "@/pages/prototype/chats/types/api";

export const NEXT_WEEK_START = "2026-10-19";
export const LAST_WEEK_START = "2026-10-12";
export const EARLIER_WEEK_START = "2026-10-05";

const NEXT_RUN_AT = "2026-10-18T17:00:00-04:00";

const UPCOMING: ReminderWeekRead = {
  week_start: NEXT_WEEK_START,
  has_run: false,
  reminders: "on",
  next_run_at: NEXT_RUN_AT,
  rows: [],
  preview: [
    {
      guardian_id: "g-monica",
      guardian_name: "Mónica Herrera",
      child_names: ["Andrés", "Lucas"],
      language: "es",
      skip_reason: null,
    },
    {
      guardian_id: "g-sandra",
      guardian_name: "Sandra Reyes",
      child_names: ["Emma"],
      language: "en",
      skip_reason: null,
    },
    {
      guardian_id: "g-luis",
      guardian_name: "Luis Navarro",
      child_names: ["Martín"],
      language: "es",
      skip_reason: null,
    },
    {
      guardian_id: "g-jorge",
      guardian_name: "Jorge Medina",
      child_names: ["Camila"],
      language: "en",
      skip_reason: "takeover",
    },
    {
      guardian_id: "g-teresa",
      guardian_name: "Teresa Vargas",
      child_names: ["Nicolás"],
      language: "es",
      skip_reason: "blocked_by_whatsapp",
    },
  ],
};

const LAST_WEEK: ReminderWeekRead = {
  week_start: LAST_WEEK_START,
  has_run: true,
  reminders: "on",
  next_run_at: NEXT_RUN_AT,
  preview: null,
  rows: [
    {
      guardian_id: "g-monica",
      guardian_name: "Mónica Herrera",
      child_names: ["Andrés", "Lucas"],
      language: "es",
      status: "read",
      skip_reason: null,
      error_code: null,
      may_have_been_delivered: false,
      sent_at: "2026-10-11T17:00:04-04:00",
    },
    {
      guardian_id: "g-luis",
      guardian_name: "Luis Navarro",
      child_names: ["Martín"],
      language: "es",
      status: "delivered",
      skip_reason: null,
      error_code: null,
      may_have_been_delivered: false,
      sent_at: "2026-10-11T17:00:05-04:00",
    },
    {
      guardian_id: "g-carlos",
      guardian_name: "Carlos Rojas",
      child_names: ["Valentina"],
      language: "en",
      status: "sent",
      skip_reason: null,
      error_code: null,
      may_have_been_delivered: false,
      sent_at: "2026-10-11T17:00:05-04:00",
    },
    {
      guardian_id: "g-teresa",
      guardian_name: "Teresa Vargas",
      child_names: ["Nicolás"],
      language: "es",
      status: "undeliverable",
      skip_reason: null,
      error_code: "63024",
      may_have_been_delivered: false,
      sent_at: "2026-10-11T17:00:06-04:00",
    },
    {
      guardian_id: "g-hector",
      guardian_name: "Héctor Molina",
      child_names: ["Paula"],
      language: "es",
      status: "failed",
      skip_reason: null,
      error_code: "delivery_unknown",
      may_have_been_delivered: true,
      sent_at: null,
    },
    {
      guardian_id: "g-jorge",
      guardian_name: "Jorge Medina",
      child_names: ["Camila"],
      language: "en",
      status: "skipped",
      skip_reason: "takeover",
      error_code: null,
      may_have_been_delivered: false,
      sent_at: null,
    },
  ],
};

const EARLIER_WEEK: ReminderWeekRead = {
  ...LAST_WEEK,
  week_start: EARLIER_WEEK_START,
  rows: LAST_WEEK.rows
    .filter((row) => row.status !== "failed")
    .map((row) => ({
      ...row,
      status: row.status === "undeliverable" ? "undeliverable" : "read",
      sent_at: row.sent_at?.replace("10-11", "10-04") ?? null,
    })),
};

export const REMINDER_WEEKS: Record<string, ReminderWeekRead> = {
  [NEXT_WEEK_START]: UPCOMING,
  [LAST_WEEK_START]: LAST_WEEK,
  [EARLIER_WEEK_START]: EARLIER_WEEK,
};

export const WEEK_ORDER = [EARLIER_WEEK_START, LAST_WEEK_START, NEXT_WEEK_START];

// The same week with the run switched off or never set up: no next run
// to promise, and no preview to show.
export function withRemindersState(
  week: ReminderWeekRead,
  state: RemindersState,
): ReminderWeekRead {
  if (state === "on") return week;
  return { ...week, reminders: state, next_run_at: null };
}

export function emptyWeek(week: ReminderWeekRead): ReminderWeekRead {
  return { ...week, rows: [], preview: week.preview ? [] : null };
}
