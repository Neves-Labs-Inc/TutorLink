// Wire shapes from api/app/schemas/settings.py, field for field.
// `value` is always a string; `value_type` says how to read it.

export type SettingValueType = "integer" | "string" | "boolean";

export type SettingRead = {
  key: string;
  value: string;
  value_type: SettingValueType;
  is_developer_only: boolean;
};

// Page[SettingRead] plus the two read-only flags.
export type SettingsPage = {
  items: SettingRead[];
  total: number;
  page: number;
  page_size: number;
  business_timezone_locked: boolean;
  reminders_paused: boolean;
};

export type SettingWrite = { key: string; value: string };

// PATCH /api/settings body.
export type SettingsUpdate = { updates: SettingWrite[] };

export type TemplateKind = "invite" | "password_reset";

// POST /api/settings/email-templates/preview and /test bodies.
export type EmailTemplatePreview = {
  template: TemplateKind;
  subject: string;
  body: string;
  brand_color: string | null;
};

export type EmailTemplatePreviewRead = { subject: string; html: string };
