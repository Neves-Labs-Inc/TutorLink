// How Guardian details word a Guardian's wire fields, and which
// Booking reminders choice Staff can record next (ported from the old
// screen's guardian reminders helpers, since removed).
import { BUSINESS_TIME_ZONE, formatDay } from "@/components/kit/format";
import type { RemindersState } from "@/components/kit/types/domain";
import type {
  ConsentAction,
  Language,
  RemindersConsent,
} from "@/types/families";

// reminder.py words a Guardian's own choice as "Guardian".
const GUARDIAN_WHO = "Guardian";

const NANP_PATTERN = /^\+1(\d{3})(\d{3})(\d{4})$/;

// Display only: the server normalises numbers, so never send this back.
export function formatPhone(e164: string): string {
  const parts = NANP_PATTERN.exec(e164);
  return parts === null ? e164 : `+1 (${parts[1]}) ${parts[2]}-${parts[3]}`;
}

// A null language isn't detected yet; the bot uses English meanwhile.
export function getLanguageLabel(language: Language | null): string {
  return language === "es" ? "Spanish" : "English";
}

const REMINDERS_LABELS: Record<RemindersConsent, RemindersState> = {
  opt_in: "Reminders on",
  opt_out: "Reminders off",
  never: "Never asked",
};

export function getRemindersLabel(reminders: RemindersConsent): RemindersState {
  return REMINDERS_LABELS[reminders];
}

export const CONSENT_ACTION_LABELS: Record<ConsentAction, RemindersState> = {
  opt_in: "Reminders on",
  opt_out: "Reminders off",
};

// The one choice Staff can record: off while on, otherwise on.
export function nextConsentAction(state: RemindersConsent): ConsentAction {
  return state === "opt_in" ? "opt_out" : "opt_in";
}

// WhatsApp's block holds until the Guardian sends START, so the API
// refuses a Staff opt-in (409); an opt-out still records.
export function canRecordConsent(
  state: RemindersConsent,
  isBlocked: boolean,
): boolean {
  return !(isBlocked && nextConsentAction(state) === "opt_in");
}

// "Oct 12, 2026": the business's day a choice was recorded on.
export function formatChoiceDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

// "Last reminder Oct 12" (the week it went out for).
export function formatLastReminder(weekStart: string | null): string {
  return weekStart === null
    ? "No reminder sent yet"
    : `Last reminder ${formatDay(weekStart, { month: "short", day: "numeric" })}`;
}

// ConsentHistoryRead.who: a Staff name, "Guardian" or "WhatsApp".
export function formatChoiceWho(who: string): string {
  return `by ${who === GUARDIAN_WHO ? "the Guardian" : who}`;
}
