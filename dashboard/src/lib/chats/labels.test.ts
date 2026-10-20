import { describe, expect, it } from "vitest";
import {
  FLAG_REASON_EXPLANATION,
  FLAG_REASON_LABEL,
  getChatTitle,
  getFirstName,
  getFlagExplanation,
  getSendErrorLabel,
  isBotProblem,
} from "@/lib/chats/labels";
import type { FlagReason } from "@/lib/queries/conversations";

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
