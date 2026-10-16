// Client-side checks that mirror settings_service._VALUE_BOUNDS, phrased
// in the units the screen shows. Keys the API leaves unbounded get a
// floor here too (see the "?" notes on those fields).
import {
  DAYS_UNITS,
  formatDuration,
  HOURS_UNITS,
  MINUTES_UNITS,
  RETENTION_UNITS,
  SECONDS_UNITS,
} from "@/pages/prototype/settings/lib/units";
import type { Unit } from "@/pages/prototype/settings/lib/units";
import {
  cleanBrandColor,
  validateBrandColor,
} from "@/lib/settings/emailTemplates";

type Bound = {
  min: number;
  max: number | null;
  // Units for the message; none means a plain count.
  units?: Unit[];
  noun: string;
  // True when the API itself has no bound and this one is a guess.
  isGuess?: boolean;
};

const DAY_MINUTES = 24 * 60;
const TEN_YEARS_DAYS = 365 * 10;
const YEAR_HOURS = 24 * 365;
const CENTURY_DAYS = 365 * 100;

export const BOUNDS: Record<string, Bound> = {
  session_length_minutes: {
    min: 1,
    max: DAY_MINUTES,
    units: MINUTES_UNITS,
    noun: "a length",
  },
  session_gap_minutes: {
    min: 0,
    max: DAY_MINUTES,
    units: MINUTES_UNITS,
    noun: "a break",
  },
  booking_lookahead_days: {
    min: 0,
    max: TEN_YEARS_DAYS,
    units: DAYS_UNITS,
    noun: "a window",
  },
  min_booking_lead_hours: {
    min: 0,
    max: YEAR_HOURS,
    units: HOURS_UNITS,
    noun: "a notice",
  },
  cancellation_cutoff_hours: {
    min: 0,
    max: null,
    units: HOURS_UNITS,
    noun: "a cutoff",
    isGuess: true,
  },
  max_slots_offered: { min: 1, max: null, noun: "a number" },
  chat_retention_days: {
    min: 0,
    max: CENTURY_DAYS,
    units: RETENTION_UNITS,
    noun: "a period",
  },
};

const RATE_LIMIT_ATTEMPTS: Bound = {
  min: 1,
  max: null,
  noun: "a number of tries",
  isGuess: true,
};
const RATE_LIMIT_WINDOW: Bound = {
  min: 60,
  max: null,
  units: SECONDS_UNITS,
  noun: "a time",
  isGuess: true,
};

export function getBound(key: string): Bound | null {
  if (key in BOUNDS) return BOUNDS[key];
  if (key.endsWith("_max_attempts")) return RATE_LIMIT_ATTEMPTS;
  if (key.endsWith("_window_seconds")) return RATE_LIMIT_WINDOW;
  return null;
}

// A minus is let through so a negative gets the range message instead.
const WHOLE_NUMBER = /^-?\d{1,18}$/;
const E164 = /^\+[1-9][0-9]{1,14}$/;

function describe(value: number, bound: Bound): string {
  return bound.units ? formatDuration(value, bound.units) : String(value);
}

// The message to show under the field, or null when the value is fine.
export function checkValue(key: string, value: string): string | null {
  if (key === "office_phone") return checkOfficePhone(value);
  if (key === "email_brand_color") {
    return validateBrandColor(cleanBrandColor(value));
  }
  const bound = getBound(key);
  if (!bound) return null;

  let error: string | null = null;
  const number = Number(value);
  if (!WHOLE_NUMBER.test(value.trim())) {
    error = "Enter a whole number.";
  } else if (number < bound.min || (bound.max !== null && number > bound.max)) {
    const range =
      bound.max === null
        ? `${describe(bound.min, bound)} or more`
        : `from ${describe(bound.min, bound)} to ${describe(bound.max, bound)}`;
    error = `Enter ${bound.noun} ${range}.`;
  }
  return error;
}

// Spaces, dashes and brackets are fine to type; the stored form is E.164.
export function toE164(typed: string): string {
  return typed.replace(/[\s().-]/g, "");
}

function checkOfficePhone(value: string): string | null {
  if (value === "") return null;
  return E164.test(value)
    ? null
    : "Enter the number with its country code, like +1 305 555 0142.";
}

const US_NUMBER = /^\+1(\d{3})(\d{3})(\d{4})$/;

export function formatPhone(e164: string): string {
  const match = US_NUMBER.exec(e164);
  return match ? `+1 (${match[1]}) ${match[2]}-${match[3]}` : e164;
}
