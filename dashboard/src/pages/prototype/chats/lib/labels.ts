// API values → UI copy (CONTEXT.md vocabulary). Raw keys, Twilio codes
// and "Meta"/"template" never reach the screen.
import type { AttentionReason } from "@/pages/prototype/shared/mock-data";
import type {
  FlagReason,
  GuardianRef,
  Language,
  ReminderRowRead,
  ReminderSkipReason,
  ReminderStatus,
} from "@/pages/prototype/chats/types/api";

export const FLAG_LABEL: Record<FlagReason, AttentionReason> = {
  booking_request: "Wants to book",
  question: "Has a question",
  guardian_link_request: "Link request",
  reactivation_request: "Reactivation request",
  stuck: "Bot got stuck",
  parse_error: "Bot didn't understand",
};

// One line under the reason: what happened and what the office does.
export const FLAG_EXPLANATION: Record<FlagReason, string> = {
  booking_request:
    "The bot can't book this one (a Child who isn't Evaluated, or a subject with no Subject level). Book it, then tell the Guardian.",
  question: "The Guardian asked something the bot can't answer.",
  guardian_link_request:
    "A second Guardian wants to be linked to a Child. Check they're who they say, then link them.",
  reactivation_request: "The Guardian asked to restore an archived Child.",
  stuck: "The bot asked twice and still couldn't get a usable answer.",
  parse_error: "The bot couldn't read the Guardian's message.",
};

export const LANGUAGE_LABEL: Record<Language, string> = {
  en: "English",
  es: "Spanish",
};

export function getLanguageLabel(language: Language | null): string {
  return language ? LANGUAGE_LABEL[language] : "Not detected (English)";
}

// Why an outbound line didn't go out.
export function getSendErrorLabel(code: string | null): string {
  const labels: Record<string, string> = {
    window_closed: "Not sent: the 24-hour window had closed.",
    template_not_approved: "Not sent: WhatsApp hasn't approved this message yet.",
    "63016": "Not sent: the 24-hour window had closed.",
    "63024": "Not sent: this number can't get WhatsApp messages.",
  };
  return (code && labels[code]) ?? "Not sent: WhatsApp didn't accept it.";
}

export const SKIP_REASON_LABEL: Record<ReminderSkipReason, string> = {
  takeover: "Chat is taken over",
  blocked_by_whatsapp: "WhatsApp blocked",
  template_not_approved: "Waiting for WhatsApp approval",
};

export type ReminderOutcome = {
  label: string;
  tone: "success" | "info" | "neutral" | "warning" | "danger";
  detail: string | null;
  needsAttention: boolean;
};

const STATUS_OUTCOME: Record<
  ReminderStatus,
  Omit<ReminderOutcome, "detail">
> = {
  read: { label: "Read", tone: "success", needsAttention: false },
  delivered: { label: "Delivered", tone: "success", needsAttention: false },
  sent: { label: "Sent", tone: "info", needsAttention: false },
  skipped: { label: "Skipped", tone: "neutral", needsAttention: false },
  failed: { label: "Not sent", tone: "danger", needsAttention: true },
  undeliverable: {
    label: "Couldn't deliver",
    tone: "danger",
    needsAttention: true,
  },
};

export function getReminderOutcome(row: ReminderRowRead): ReminderOutcome {
  const base = STATUS_OUTCOME[row.status];
  let outcome: ReminderOutcome = { ...base, detail: null };
  if (row.status === "failed" && row.may_have_been_delivered) {
    outcome = {
      label: "May have arrived",
      tone: "warning",
      needsAttention: true,
      detail: "The send was cut off. Check the chat before sending again.",
    };
  } else if (row.skip_reason) {
    outcome = { ...outcome, detail: SKIP_REASON_LABEL[row.skip_reason] };
  } else if (base.needsAttention) {
    const reason = getSendErrorLabel(row.error_code).replace("Not sent: ", "");
    outcome = {
      ...outcome,
      detail: reason.charAt(0).toUpperCase() + reason.slice(1),
    };
  }
  return outcome;
}

// A chat is named after its Guardian, or its number until Intake ends.
export function getChatTitle(
  guardian: GuardianRef | null,
  phone: string,
): string {
  return guardian?.name ?? phone;
}
