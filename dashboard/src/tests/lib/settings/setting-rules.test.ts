import { describe, expect, it } from "vitest";
import { checkSettingValue } from "@/lib/settings/setting-rules";

describe("checkSettingValue", () => {
  it.each([
    ["session_length_minutes", "1"],
    ["session_length_minutes", "1440"],
    ["session_gap_minutes", "0"],
    ["booking_lookahead_days", "3650"],
    ["min_booking_lead_hours", "8760"],
    ["cancellation_cutoff_hours", "0"],
    ["cancellation_cutoff_hours", "8760"],
    ["max_slots_offered", "1"],
    ["max_slots_offered", "500"],
    ["chat_retention_days", "0"],
    ["retention_purge_hour_utc", "23"],
    ["reminder_weekday", "7"],
    ["reminder_hour", "0"],
    ["login_rate_limit_ip_max_attempts", "1"],
    ["login_rate_limit_email_window_seconds", "60"],
    ["forgot_password_rate_limit_ip_window_seconds", "2678400"],
  ])("accepts %s = %s", (key, value) => {
    expect(checkSettingValue(key, value)).toBeNull();
  });

  it.each([
    ["session_length_minutes", "0", "Enter a length from 1 minute to 1 day."],
    ["session_length_minutes", "1441", "Enter a length from 1 minute to 1 day."],
    ["session_gap_minutes", "-5", "Enter a break from 0 minutes to 1 day."],
    ["booking_lookahead_days", "3651", "Enter a window from 0 days to 10 years."],
    ["min_booking_lead_hours", "8761", "Enter a notice from 0 hours to 365 days."],
    [
      "cancellation_cutoff_hours",
      "8761",
      "Enter a cutoff from 0 hours to 365 days.",
    ],
    ["max_slots_offered", "0", "Enter 1 or more."],
    ["chat_retention_days", "36501", "Enter a period from 0 days to 100 years."],
    ["login_rate_limit_ip_max_attempts", "0", "Enter 1 or more tries."],
    [
      "login_rate_limit_email_window_seconds",
      "59",
      "Enter a time from 1 minute to 31 days.",
    ],
    [
      "forgot_password_rate_limit_email_window_seconds",
      "2678401",
      "Enter a time from 1 minute to 31 days.",
    ],
  ])("refuses %s = %s in the field's units", (key, value, message) => {
    expect(checkSettingValue(key, value)).toBe(message);
  });

  it.each(["", "abc", "1.5", "1e3", " "])(
    "refuses a non-whole number %j with the range message",
    (value) => {
      expect(checkSettingValue("session_length_minutes", value)).toBe(
        "Enter a length from 1 minute to 1 day.",
      );
    },
  );

  it("leaves keys without a rule alone", () => {
    expect(checkSettingValue("reminder_template_sid_en", "anything")).toBeNull();
  });

  describe("office phone", () => {
    const PHONE_ERROR =
      "Enter the number with its country code, like +1 305 555 0142.";

    it.each(["", "+13055550142", "+525512345678"])("accepts %j", (value) => {
      expect(checkSettingValue("office_phone", value)).toBeNull();
    });

    it.each(["3055550142", "+1305555014", "+130555501421", "+0123", "+1abc"])(
      "refuses %j",
      (value) => {
        expect(checkSettingValue("office_phone", value)).toBe(PHONE_ERROR);
      },
    );
  });

  describe("office address", () => {
    it("accepts 500 characters and an empty address", () => {
      expect(checkSettingValue("office_address", "a".repeat(500))).toBeNull();
      expect(checkSettingValue("office_address", "")).toBeNull();
    });

    it("measures the address without surrounding space, as the API does", () => {
      expect(checkSettingValue("office_address", `${"a".repeat(500)}\n `)).toBeNull();
    });

    it("refuses 501 characters", () => {
      expect(checkSettingValue("office_address", "a".repeat(501))).toBe(
        "Keep the address to 500 characters or fewer.",
      );
    });
  });
});
