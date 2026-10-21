// The unit pickers for the Settings durations that need more than the
// kit's stock ladders. `factor` is how many stored units one holds.
import type { Unit } from "@/components/kit/lib/units";

const MONTH_D = 30;
const YEAR_D = 365;
const MINUTE_S = 60;
const HOUR_S = 3600;
const DAY_S = 86_400;

// Chat retention is stored in days.
export const RETENTION_UNITS: Unit[] = [
  { id: "days", one: "day", many: "days", factor: 1 },
  { id: "months", one: "month", many: "months", factor: MONTH_D },
  { id: "years", one: "year", many: "years", factor: YEAR_D },
];

// The sign-in rate-limit windows are stored in seconds.
export const WINDOW_UNITS: Unit[] = [
  { id: "minutes", one: "minute", many: "minutes", factor: MINUTE_S },
  { id: "hours", one: "hour", many: "hours", factor: HOUR_S },
  { id: "days", one: "day", many: "days", factor: DAY_S },
];
