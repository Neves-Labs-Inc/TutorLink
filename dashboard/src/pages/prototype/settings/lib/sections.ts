// The placeholder grouping (an open question, marked "?" on screen):
// which section each setting key lives in. Every admin-visible key of
// system_settings appears exactly once.

export type SectionId =
  | "booking-rules"
  | "reminders"
  | "office"
  | "emails"
  | "chat-history"
  | "sign-in"
  | "developer";

export type SectionDef = {
  id: SectionId;
  title: string;
  description: string;
  keys: string[];
  isDeveloperOnly?: boolean;
};

export const SECTIONS: SectionDef[] = [
  {
    id: "booking-rules",
    title: "Booking rules",
    description: "What the bot offers Guardians, and what it lets them change.",
    keys: [
      "session_length_minutes",
      "session_gap_minutes",
      "booking_lookahead_days",
      "min_booking_lead_hours",
      "cancellation_cutoff_hours",
      "max_slots_offered",
    ],
  },
  {
    id: "reminders",
    title: "Booking reminders",
    description:
      "A weekly WhatsApp message to Guardians with nothing booked for the coming week.",
    keys: ["reminders_enabled", "reminder_weekday", "reminder_hour"],
  },
  {
    id: "office",
    title: "Office",
    description: "Contact details and the clock everything runs on.",
    keys: [
      "office_phone",
      "office_address",
      "default_phone_country_code",
      "business_timezone",
    ],
  },
  {
    id: "emails",
    title: "Emails",
    description: "The emails Staff get to set up or reset their password.",
    keys: [
      "email_brand_color",
      "email_invite_subject",
      "email_invite_body",
      "email_reset_subject",
      "email_reset_body",
    ],
  },
  {
    id: "chat-history",
    title: "Chat history",
    description: "How long WhatsApp chats are kept before they're deleted.",
    keys: ["chat_retention_days", "retention_purge_hour_utc"],
  },
  {
    id: "sign-in",
    title: "Sign-in protection",
    description:
      "Slows down anyone guessing passwords. The defaults suit most offices.",
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
  },
  {
    id: "developer",
    title: "Developer only",
    description: "Hidden from Admins. Set once WhatsApp approves a message.",
    keys: ["reminder_template_sid_en", "reminder_template_sid_es"],
    isDeveloperOnly: true,
  },
];

// Template subjects, bodies and the button colour save from the email
// editor, not the page.
export const EDITOR_KEYS = [
  "email_brand_color",
  "email_invite_subject",
  "email_invite_body",
  "email_reset_subject",
  "email_reset_body",
];
