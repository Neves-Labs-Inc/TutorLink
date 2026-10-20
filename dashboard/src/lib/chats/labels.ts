// API values → UI copy (CONTEXT.md vocabulary). Raw keys, Twilio codes
// and "Meta"/"template" never reach the screen.
import type { AttentionReason } from "@/components/kit/types/domain";
import type { FlagReason } from "@/lib/queries/conversations";

export const FLAG_REASON_LABEL: Record<FlagReason, AttentionReason> = {
  booking_request: "Wants to book",
  question: "Has a question",
  guardian_link_request: "Link request",
  reactivation_request: "Reactivation request",
  stuck: "Bot got stuck",
  didnt_understand: "Bot didn't understand",
  reply_window_closed: "Reply window closed",
};

// One line under the reason: what happened and what the office does.
// `reply_window_closed` holds a `{first}` placeholder for the Guardian's first
// name; read explanations through `getFlagExplanation`, which fills it.
export const FLAG_REASON_EXPLANATION: Record<FlagReason, string> = {
  booking_request:
    "The bot can’t book this one (a Child who isn’t Evaluated, or a subject with no Subject level). Book it, then tell the Guardian.",
  question: "The Guardian asked something the bot can’t answer.",
  guardian_link_request:
    "A second Guardian wants to be linked to a Child. Check they’re who they say, then link them.",
  reactivation_request: "The Guardian asked to restore an archived Child.",
  stuck:
    "Something failed on the bot’s side. The Guardian was told the office will get back to them.",
  didnt_understand:
    "The bot kept failing to make sense of the Guardian’s messages.",
  reply_window_closed:
    "WhatsApp’s 24-hour reply window closed while this chat was taken over. Reach {first} outside the bot, or hand it back.",
};

export function getFlagExplanation(
  reason: FlagReason,
  firstName: string,
): string {
  return FLAG_REASON_EXPLANATION[reason].replace("{first}", firstName);
}

const BOT_PROBLEMS: FlagReason[] = ["stuck", "didnt_understand"];

export function isBotProblem(reason: FlagReason): boolean {
  return BOT_PROBLEMS.includes(reason);
}

// A chat is named after its Guardian, or its number until Intake ends.
export function getChatTitle(
  guardian: { name: string } | null,
  phone: string,
): string {
  return guardian?.name ?? phone;
}

export function getFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

const SEND_ERROR_LABELS: Record<string, string> = {
  window_closed: "Not sent: the 24-hour window had closed.",
  template_not_approved: "Not sent: WhatsApp hasn’t approved this message yet.",
  "63016": "Not sent: the 24-hour window had closed.",
  "63024": "Not sent: this number can’t get WhatsApp messages.",
};

// Why an outbound line didn't go out.
export function getSendErrorLabel(code: string | null): string {
  return (code && SEND_ERROR_LABELS[code]) ?? "Not sent: WhatsApp didn’t accept it.";
}
