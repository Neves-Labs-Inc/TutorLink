// Durations: settings store one base unit (seconds, minutes, hours or
// days); the screen shows a number plus a unit picker, so "900" seconds
// reads as "15 minutes" and "365" days as "1 year".

export type Unit = {
  id: string;
  one: string;
  many: string;
  // How many base units one of this unit holds.
  factor: number;
};

const MINUTE_S = 60;
const HOUR_S = 3600;
const HOUR_M = 60;
const DAY_H = 24;
const WEEK_D = 7;
const YEAR_D = 365;

export const SECONDS_UNITS: Unit[] = [
  { id: "minutes", one: "minute", many: "minutes", factor: MINUTE_S },
  { id: "hours", one: "hour", many: "hours", factor: HOUR_S },
];

export const MINUTES_UNITS: Unit[] = [
  { id: "minutes", one: "minute", many: "minutes", factor: 1 },
  { id: "hours", one: "hour", many: "hours", factor: HOUR_M },
];

export const HOURS_UNITS: Unit[] = [
  { id: "hours", one: "hour", many: "hours", factor: 1 },
  { id: "days", one: "day", many: "days", factor: DAY_H },
];

export const DAYS_UNITS: Unit[] = [
  { id: "days", one: "day", many: "days", factor: 1 },
  { id: "weeks", one: "week", many: "weeks", factor: WEEK_D },
];

export const RETENTION_UNITS: Unit[] = [
  { id: "days", one: "day", many: "days", factor: 1 },
  { id: "years", one: "year", many: "years", factor: YEAR_D },
];

export type DurationParts = { amount: string; unitId: string };

// The largest unit that divides the value evenly, so nothing is rounded.
export function splitDuration(value: string, units: Unit[]): DurationParts {
  const base = Number(value);
  if (!Number.isInteger(base) || base === 0) {
    return { amount: value, unitId: units[0].id };
  }
  const fitting = [...units].reverse().find((unit) => base % unit.factor === 0);
  const unit = fitting ?? units[0];
  return { amount: String(base / unit.factor), unitId: unit.id };
}

export function joinDuration(parts: DurationParts, units: Unit[]): string {
  const unit = units.find((option) => option.id === parts.unitId) ?? units[0];
  const amount = Number(parts.amount);
  if (parts.amount.trim() === "" || !Number.isFinite(amount)) return parts.amount;
  return String(Math.round(amount * unit.factor));
}

export function formatDuration(value: number, units: Unit[]): string {
  const parts = splitDuration(String(value), units);
  const unit = units.find((option) => option.id === parts.unitId) ?? units[0];
  return `${parts.amount} ${parts.amount === "1" ? unit.one : unit.many}`;
}
