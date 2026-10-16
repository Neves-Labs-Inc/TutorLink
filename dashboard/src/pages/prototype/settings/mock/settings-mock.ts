// Every system_settings row the migrations seed today (0004 through
// 0041), with the seeded values. Developer-only rows are only sent to a
// Developer; an Admin never receives them. `office_address` is NOT in the
// API yet: an assumed new string row (see the "?" on the field).
import type {
  SettingRead,
  SettingsPage,
} from "@/pages/prototype/settings/types/api";

const INVITE_BODY = [
  "Hi {name},",
  "",
  "{actor_name} has added you to TutorLink. To get started, choose your password using the link below:",
  "",
  "{link}",
  "",
  "This link works once and expires in 7 days. If it expires, ask {actor_name} to send you a new invite.",
  "",
  "See you soon,",
  "The TutorLink team",
].join("\n");

const RESET_BODY = [
  "Hi {name},",
  "",
  "We received a request to reset your TutorLink password. Choose a new one using the link below:",
  "",
  "{link}",
  "",
  "This link works once and expires in 48 hours. If you didn't ask for this, you can safely ignore this email and your password won't change.",
  "",
  "The TutorLink team",
].join("\n");

function row(
  key: string,
  value: string,
  valueType: SettingRead["value_type"] = "integer",
  isDeveloperOnly = false,
): SettingRead {
  return {
    key,
    value,
    value_type: valueType,
    is_developer_only: isDeveloperOnly,
  };
}

const ROWS: SettingRead[] = [
  row("booking_lookahead_days", "90"),
  row("business_timezone", "America/New_York", "string"),
  row("cancellation_cutoff_hours", "24"),
  row("chat_retention_days", "365"),
  row("default_phone_country_code", "1"),
  row("email_brand_color", "#74C8C9", "string"),
  row("email_invite_body", INVITE_BODY, "string"),
  row("email_invite_subject", "{actor_name} invited you to TutorLink", "string"),
  row("email_reset_body", RESET_BODY, "string"),
  row("email_reset_subject", "Reset your TutorLink password", "string"),
  row("forgot_password_rate_limit_email_max_attempts", "3"),
  row("forgot_password_rate_limit_email_window_seconds", "3600"),
  row("forgot_password_rate_limit_ip_max_attempts", "10"),
  row("forgot_password_rate_limit_ip_window_seconds", "900"),
  row("login_rate_limit_email_max_attempts", "5"),
  row("login_rate_limit_email_window_seconds", "900"),
  row("login_rate_limit_ip_max_attempts", "20"),
  row("login_rate_limit_ip_window_seconds", "900"),
  row("max_slots_offered", "5"),
  row("min_booking_lead_hours", "0"),
  row("office_address", "8450 NW 53rd St, Suite 210\nDoral, FL 33166", "string"),
  row("office_phone", "+13055550142", "string"),
  row("reminder_hour", "18"),
  row("reminder_template_sid_en", "HX5c1e0f2a9b7d4e3f8a6b2c1d0e9f8a7b", "string", true),
  row("reminder_template_sid_es", "HX9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d", "string", true),
  row("reminder_weekday", "7"),
  row("reminders_enabled", "true", "boolean"),
  row("retention_purge_hour_utc", "3"),
  row("session_gap_minutes", "30"),
  row("session_length_minutes", "60"),
];

export type MockOptions = {
  isDeveloper: boolean;
  isTimezoneLocked: boolean;
  isRemindersPaused: boolean;
  areRemindersEnabled: boolean;
};

// What GET /api/settings would return for this role and setup.
export function getSettingsPage(options: MockOptions): SettingsPage {
  const items = ROWS.filter(
    (setting) => options.isDeveloper || !setting.is_developer_only,
  ).map((setting) => {
    if (setting.key === "reminders_enabled") {
      return { ...setting, value: String(options.areRemindersEnabled) };
    }
    if (options.isRemindersPaused && setting.key.includes("_template_sid_")) {
      return { ...setting, value: "" };
    }
    return setting;
  });
  return {
    items,
    total: items.length,
    page: 1,
    page_size: items.length,
    business_timezone_locked: options.isTimezoneLocked,
    reminders_paused: options.isRemindersPaused,
  };
}
