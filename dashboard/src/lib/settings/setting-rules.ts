// Client checks that mirror settings_service._VALUE_BOUNDS and its string
// rules, phrased in the units a person reads ("1 day", not "1440").
import { formatDuration } from "@/components/kit/lib/units";
import type { Unit } from "@/components/kit/lib/units";

type Bound = {
  min: number;
  // null: no upper bound.
  max: number | null;
  noun: string;
  // How the range reads; none means a plain count.
  units?: Unit[];
  // What an unbounded count counts, when "Enter 1 or more." is too bare.
  countNoun?: string;
};

const MINUTE_S = 60;
const HOUR_M = 60;
const DAY_H = 24;
const DAY_M = DAY_H * HOUR_M;
const DAY_S = DAY_M * MINUTE_S;
const YEAR_D = 365;

// Message ladders: each reads a value in its base unit with the largest
// unit that divides it evenly.
const MINUTE_LADDER: Unit[] = [
  { id: "minutes", one: "minute", many: "minutes", factor: 1 },
  { id: "hours", one: "hour", many: "hours", factor: HOUR_M },
  { id: "days", one: "day", many: "days", factor: DAY_M },
];
const HOUR_LADDER: Unit[] = [
  { id: "hours", one: "hour", many: "hours", factor: 1 },
  { id: "days", one: "day", many: "days", factor: DAY_H },
];
const DAY_LADDER: Unit[] = [
  { id: "days", one: "day", many: "days", factor: 1 },
  { id: "years", one: "year", many: "years", factor: YEAR_D },
];
const SECOND_LADDER: Unit[] = [
  { id: "minutes", one: "minute", many: "minutes", factor: MINUTE_S },
  { id: "hours", one: "hour", many: "hours", factor: HOUR_M * MINUTE_S },
  { id: "days", one: "day", many: "days", factor: DAY_S },
];

const LAST_HOUR = 23;

const BOUNDS: Record<string, Bound> = {
  session_length_minutes: {
    min: 1,
    max: DAY_M,
    noun: "a length",
    units: MINUTE_LADDER,
  },
  session_gap_minutes: {
    min: 0,
    max: DAY_M,
    noun: "a break",
    units: MINUTE_LADDER,
  },
  booking_lookahead_days: {
    min: 0,
    max: 10 * YEAR_D,
    noun: "a window",
    units: DAY_LADDER,
  },
  min_booking_lead_hours: {
    min: 0,
    max: YEAR_D * DAY_H,
    noun: "a notice",
    units: HOUR_LADDER,
  },
  cancellation_cutoff_hours: {
    min: 0,
    max: YEAR_D * DAY_H,
    noun: "a cutoff",
    units: HOUR_LADDER,
  },
  max_slots_offered: { min: 1, max: null, noun: "a number" },
  chat_retention_days: {
    min: 0,
    max: 100 * YEAR_D,
    noun: "a period",
    units: DAY_LADDER,
  },
  retention_purge_hour_utc: { min: 0, max: LAST_HOUR, noun: "an hour" },
  reminder_weekday: { min: 1, max: 7, noun: "a weekday" },
  reminder_hour: { min: 0, max: LAST_HOUR, noun: "an hour" },
};

// The API lets 0 switch a bucket off; the screen asks for 1 or more
// (Franklin 2026-10-20).
const RATE_LIMIT_TRIES: Bound = {
  min: 1,
  max: null,
  noun: "a number",
  countNoun: "tries",
};
const RATE_LIMIT_WINDOW: Bound = {
  min: MINUTE_S,
  max: 31 * DAY_S,
  noun: "a time",
  units: SECOND_LADDER,
};

export const OFFICE_PHONE_KEY = "office_phone";
export const OFFICE_ADDRESS_KEY = "office_address";
export const MAX_ADDRESS_LENGTH = 500;
export const PHONE_ERROR =
  "Enter the number with its country code, like +1 305 555 0142.";
export const ADDRESS_ERROR = `Keep the address to ${MAX_ADDRESS_LENGTH} characters or fewer.`;

// A minus is let through so a negative gets the range message.
const WHOLE_NUMBER = /^-?\d{1,18}$/;
const E164 = /^\+[1-9]\d{1,14}$/;
// +1 numbers (US and Canada) are always ten digits after the code.
const NANP_PREFIX = "+1";
const NANP = /^\+1\d{10}$/;

function getBound(key: string): Bound | null {
  let bound: Bound | null = BOUNDS[key] ?? null;
  if (key.endsWith("_max_attempts")) bound = RATE_LIMIT_TRIES;
  if (key.endsWith("_window_seconds")) bound = RATE_LIMIT_WINDOW;
  return bound;
}

function describe(value: number, bound: Bound): string {
  return bound.units ? formatDuration(value, bound.units) : String(value);
}

function checkNumber(value: string, bound: Bound): string | null {
  const trimmed = value.trim();
  const number = Number(trimmed);
  const isInRange =
    WHOLE_NUMBER.test(trimmed) &&
    number >= bound.min &&
    (bound.max === null || number <= bound.max);
  if (isInRange) return null;

  const count = [bound.min, "or more", bound.countNoun].filter(Boolean);
  return bound.max === null
    ? `Enter ${count.join(" ")}.`
    : `Enter ${bound.noun} from ${describe(bound.min, bound)} to ${describe(bound.max, bound)}.`;
}

function checkPhone(value: string): string | null {
  if (value === "") return null;

  const isValid =
    E164.test(value) && (!value.startsWith(NANP_PREFIX) || NANP.test(value));
  return isValid ? null : PHONE_ERROR;
}

// The message to show under the field, or null when the value is fine.
export function checkSettingValue(key: string, value: string): string | null {
  if (key === OFFICE_PHONE_KEY) return checkPhone(value);
  if (key === OFFICE_ADDRESS_KEY) {
    // The API strips the address before it measures it.
    return value.trim().length > MAX_ADDRESS_LENGTH ? ADDRESS_ERROR : null;
  }

  const bound = getBound(key);
  return bound ? checkNumber(value, bound) : null;
}
