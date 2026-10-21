import { describe, expect, it } from "vitest";
import {
  FLAG_REASON_EXPLANATION,
  FLAG_REASON_LABEL,
  getChatTitle,
  getFirstName,
  getFlagExplanation,
  getReminderOutcome,
  getSendErrorLabel,
  isBotProblem,
} from "@/lib/chats/labels";
import type { FlagReason } from "@/lib/queries/conversations";
import type { ReminderRow } from "@/lib/reminders/reminders";

const REASONS: FlagReason[] = [
  "booking_request",
  "question",
  "guardian_link_request",
  "reactivation_request",
  "stuck",
  "didnt_understand",
  "reply_window_closed",
];

describe("flag reasons", () => {
  it.each(REASONS)("%s has a label and an explanation", (reason) => {
    expect(FLAG_REASON_LABEL[reason]).toBeTruthy();
    expect(getFlagExplanation(reason, "Maria")).toBeTruthy();
    expect(FLAG_REASON_EXPLANATION[reason]).toBeTruthy();
  });

  it("names the Guardian in the reply-window explanation", () => {
    expect(getFlagExplanation("reply_window_closed", "Maria")).toBe(
      "WhatsApp’s 24-hour reply window closed while this chat was taken over. Reach Maria outside the bot, or hand it back.",
    );
  });

  it("treats only the two bot failures as bot problems", () => {
    expect(REASONS.filter(isBotProblem)).toEqual(["stuck", "didnt_understand"]);
  });
});

describe("names", () => {
  it("titles a chat by Guardian, or by number before Intake ends", () => {
    expect(getChatTitle({ name: "Maria Lopez" }, "+13055550100")).toBe("Maria Lopez");
    expect(getChatTitle(null, "+13055550100")).toBe("+13055550100");
  });

  it("takes the first name", () => {
    expect(getFirstName("Maria Lopez")).toBe("Maria");
  });
});

describe("getSendErrorLabel", () => {
  it("explains a closed window", () => {
    expect(getSendErrorLabel("63016")).toBe("Not sent: the 24-hour window had closed.");
  });

  it("falls back for an unknown or missing code", () => {
    expect(getSendErrorLabel(null)).toBe("Not sent: WhatsApp didn’t accept it.");
    expect(getSendErrorLabel("99999")).toBe("Not sent: WhatsApp didn’t accept it.");
  });
});

describe("getReminderOutcome", () => {
  const row = (overrides: Partial<ReminderRow>): ReminderRow => ({
    guardian_id: "g-1",
    guardian_name: "Diana Gómez",
    child_names: ["Emma"],
    language: "en",
    status: "sent",
    skip_reason: null,
    error_code: null,
    may_have_been_delivered: false,
    sent_at: null,
    ...overrides,
  });

  it("labels a read reminder as success without attention", () => {
    expect(getReminderOutcome(row({ status: "read" }))).toEqual({
      label: "Read",
      tone: "success",
      detail: null,
      needsAttention: false,
    });
  });

  it("says why a skipped reminder was skipped, without flagging it", () => {
    const outcome = getReminderOutcome(
      row({ status: "skipped", skip_reason: "takeover" }),
    );
    expect(outcome.label).toBe("Skipped");
    expect(outcome.detail).toBe("Chat is taken over");
    expect(outcome.needsAttention).toBe(false);
  });

  it("flags a failed send whose delivery is unknown", () => {
    const outcome = getReminderOutcome(
      row({ status: "failed", may_have_been_delivered: true }),
    );
    expect(outcome.label).toBe("May have arrived");
    expect(outcome.tone).toBe("warning");
    expect(outcome.detail).toBe(
      "The send was cut off. Check the chat before sending again.",
    );
    expect(outcome.needsAttention).toBe(true);
  });

  it("explains an undeliverable reminder from its error code", () => {
    const outcome = getReminderOutcome(
      row({ status: "undeliverable", error_code: "63024" }),
    );
    expect(outcome.label).toBe("Couldn’t deliver");
    expect(outcome.detail).toBe("This number can’t get WhatsApp messages.");
    expect(outcome.needsAttention).toBe(true);
  });
});
