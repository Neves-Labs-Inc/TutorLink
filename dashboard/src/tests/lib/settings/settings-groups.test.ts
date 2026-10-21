import { describe, expect, it } from "vitest";
import {
  countChangesIn,
  findFieldError,
  getChangedUpdates,
  wouldShortenRetention,
} from "@/lib/settings/settings-groups";
import type { Setting } from "@/lib/settings/settings";

function row(key: string, value: string): Setting {
  return { key, value, value_type: "string", is_developer_only: false };
}

const ITEMS = [
  row("session_length_minutes", "50"),
  row("office_phone", ""),
  row("business_timezone", "America/New_York"),
  row("email_invite_subject", "Welcome"),
  row("email_reset_brand_color", "#74C8C9"),
  row("chat_retention_days", "365"),
];

describe("getChangedUpdates", () => {
  it("sends only changed plain keys", () => {
    const updates = getChangedUpdates(ITEMS, {
      session_length_minutes: "60",
      office_phone: "",
      business_timezone: "America/Chicago",
      email_invite_subject: "Hi",
      email_reset_brand_color: "#000000",
    });
    expect(updates).toEqual([{ key: "session_length_minutes", value: "60" }]);
  });

  it("counts changes per group", () => {
    const updates = [
      { key: "session_length_minutes", value: "60" },
      { key: "max_slots_offered", value: "3" },
      { key: "office_phone", value: "+13055550142" },
    ];
    expect(countChangesIn("booking-rules", updates)).toBe(2);
    expect(countChangesIn("office", updates)).toBe(1);
    expect(countChangesIn("developer", updates)).toBe(0);
  });
});

describe("wouldShortenRetention", () => {
  it.each([
    ["365", "30", true],
    ["365", "730", false],
    ["365", "0", false],
    ["0", "30", true],
  ])("from %s days to %s days: %s", (saved, next, expected) => {
    const items = [row("chat_retention_days", saved)];
    const updates = [{ key: "chat_retention_days", value: next }];
    expect(wouldShortenRetention(items, updates)).toBe(expected);
  });

  it("is false when retention is not being changed", () => {
    expect(wouldShortenRetention(ITEMS, [])).toBe(false);
  });
});

describe("findFieldError", () => {
  const SENT = ["office_phone", "office_address", "max_slots_offered"];

  it("words the service's phone message for the field", () => {
    expect(
      findFieldError(
        "office_phone must be a phone number in E.164 form, like +15551234567",
        SENT,
      ),
    ).toEqual({
      key: "office_phone",
      message: "Enter the number with its country code, like +1 305 555 0142.",
    });
  });

  it("shows a '<key>: …' message without the key", () => {
    expect(findFieldError("max_slots_offered: too many", SENT)).toEqual({
      key: "max_slots_offered",
      message: "Too many",
    });
  });

  it("ignores a detail that names no sent key", () => {
    expect(
      findFieldError("That value is not valid for this setting's type", SENT),
    ).toBeNull();
    expect(findFieldError("office_phonebook: nope", SENT)).toBeNull();
  });
});
