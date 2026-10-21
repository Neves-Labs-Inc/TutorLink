// Wire values to the words the Families screens show.
import type { RemindersState } from "@/components/kit/types/domain";
import type { HouseholdHome, Language, RemindersConsent } from "@/types/families";

const NANP_PATTERN = /^\+1(\d{3})(\d{3})(\d{4})$/;

// Display only: the server's E.164 number is what gets sent back.
export function formatPhone(phone: string): string {
  const match = NANP_PATTERN.exec(phone);
  return match ? `+1 ${match[1]} ${match[2]} ${match[3]}` : phone;
}

// Null means the bot hasn't detected one; it uses English.
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

// "Dad’s: 1200 Brickell Ave" or just the address.
export function getHomeLabel(home: Pick<HouseholdHome, "label" | "address">): string {
  return home.label ? `${home.label}: ${home.address}` : home.address;
}
