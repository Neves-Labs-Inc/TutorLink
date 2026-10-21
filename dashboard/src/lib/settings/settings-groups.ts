// Which group each setting lives in on the Settings page, and which
// changes the page's one Save sends. Every Admin-visible key of
// system_settings appears exactly once.
import type { Setting, SettingUpdate } from "@/lib/settings/settings";
import {
  ADDRESS_ERROR,
  OFFICE_ADDRESS_KEY,
  OFFICE_PHONE_KEY,
  PHONE_ERROR,
} from "@/lib/settings/setting-rules";

export type GroupId =
  | "booking-rules"
  | "reminders"
  | "office"
  | "emails"
  | "chat-history"
  | "sign-in"
  | "developer";

export type SettingsGroup = {
  id: GroupId;
  title: string;
  keys: readonly string[];
  isDeveloperOnly: boolean;
};

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: "booking-rules",
    title: "Booking rules",
    keys: [
      "session_length_minutes",
      "session_gap_minutes",
      "booking_lookahead_days",
      "min_booking_lead_hours",
      "cancellation_cutoff_hours",
      "max_slots_offered",
    ],
    isDeveloperOnly: false,
  },
  {
    id: "reminders",
    title: "Booking reminders",
    keys: ["reminders_enabled", "reminder_weekday", "reminder_hour"],
    isDeveloperOnly: false,
  },
  {
    id: "office",
    title: "Office",
    keys: [
      OFFICE_PHONE_KEY,
      OFFICE_ADDRESS_KEY,
      "default_phone_country_code",
      "business_timezone",
    ],
    isDeveloperOnly: false,
  },
  {
    id: "emails",
    title: "Emails",
    keys: [
      "email_invite_brand_color",
      "email_invite_subject",
      "email_invite_body",
      "email_reset_brand_color",
      "email_reset_subject",
      "email_reset_body",
    ],
    isDeveloperOnly: false,
  },
  {
    id: "chat-history",
    title: "Chat history",
    keys: ["chat_retention_days", "retention_purge_hour_utc"],
    isDeveloperOnly: false,
  },
  {
    id: "sign-in",
    title: "Sign-in protection",
    keys: [
      "login_rate_limit_email_max_attempts",
      "login_rate_limit_email_window_seconds",
      "login_rate_limit_ip_max_attempts",
      "login_rate_limit_ip_window_seconds",
      "forgot_password_rate_limit_email_max_attempts",
      "forgot_password_rate_limit_email_window_seconds",
      "forgot_password_rate_limit_ip_max_attempts",
      "forgot_password_rate_limit_ip_window_seconds",
    ],
    isDeveloperOnly: false,
  },
  {
    id: "developer",
    title: "Developer only",
    keys: ["reminder_template_sid_en", "reminder_template_sid_es"],
    isDeveloperOnly: true,
  },
];

export const BUSINESS_TIMEZONE_KEY = "business_timezone";
const RETENTION_KEY = "chat_retention_days";

// Email subjects, bodies and colours save from the email editor, and the
// time zone is never written from this page.
const NOT_PLAIN_KEYS: ReadonlySet<string> = new Set([
  ...(SETTINGS_GROUPS.find((group) => group.id === "emails")?.keys ?? []),
  BUSINESS_TIMEZONE_KEY,
]);

export function isPlainKey(key: string): boolean {
  return !NOT_PLAIN_KEYS.has(key);
}

export function readSetting(items: readonly Setting[], key: string): string {
  return items.find((item) => item.key === key)?.value ?? "";
}

// The changed plain keys, as one PATCH /api/settings would send them.
export function getChangedUpdates(
  items: readonly Setting[],
  draft: Readonly<Record<string, string>>,
): SettingUpdate[] {
  return Object.entries(draft)
    .filter(([key]) => isPlainKey(key))
    .filter(([key, value]) => value !== readSetting(items, key))
    .map(([key, value]) => ({ key, value }));
}

export function countChangesIn(
  groupId: GroupId,
  updates: readonly SettingUpdate[],
): number {
  const keys = SETTINGS_GROUPS.find((group) => group.id === groupId)?.keys;
  return updates.filter((update) => keys?.includes(update.key)).length;
}

// True when saving would delete chats sooner than today's setting does.
// 0 keeps chats forever, so leaving 0 for any period shortens it.
export function wouldShortenRetention(
  items: readonly Setting[],
  updates: readonly SettingUpdate[],
): boolean {
  const update = updates.find((entry) => entry.key === RETENTION_KEY);
  if (!update) return false;

  const saved = Number(readSetting(items, RETENTION_KEY));
  const next = Number(update.value);
  return next !== 0 && (saved === 0 || next < saved);
}

export type FieldError = { key: string; message: string };

// Messages the screen words itself rather than echo the API's, which
// name the raw key.
const FIELD_MESSAGES: Readonly<Record<string, string>> = {
  [OFFICE_PHONE_KEY]: PHONE_ERROR,
  [OFFICE_ADDRESS_KEY]: ADDRESS_ERROR,
};
const GENERIC_FIELD_MESSAGE = "TutorLink didn’t accept this value.";

// A 400 detail that names one of the sent keys ("<key>: …" or the
// service's "<key> must be …"), as the message to show under that field.
export function findFieldError(
  detail: string,
  sentKeys: readonly string[],
): FieldError | null {
  const key = sentKeys.find(
    (candidate) =>
      detail.startsWith(`${candidate}:`) || detail.startsWith(`${candidate} `),
  );
  if (!key) return null;

  const rest = detail.slice(key.length).replace(/^[:\s]+/, "");
  const isOwnWords = detail.startsWith(`${key}:`) && rest !== "";
  let message = FIELD_MESSAGES[key] ?? GENERIC_FIELD_MESSAGE;
  if (!FIELD_MESSAGES[key] && isOwnWords) {
    message = rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  return { key, message };
}
