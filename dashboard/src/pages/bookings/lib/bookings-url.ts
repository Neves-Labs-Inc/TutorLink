// The Bookings page's state as URL search params, so back/forward and
// links from other areas (?staff=, ?needs_attention=1) land on the same
// page. Defaults are left out of the URL.
import type { BookingKind, BookingStatus } from "@/lib/queries/bookings";
import { getWeekStart } from "@/lib/week";

export type BookingsView = "list" | "calendar";

export type BookingsUrlState = {
  q: string;
  kinds: BookingKind[];
  // Staff user ids.
  staffIds: string[];
  // Families link here with a family's Children (?child=…&child=…).
  childIds: string[];
  statuses: BookingStatus[];
  isMine: boolean;
  isNeedsAttention: boolean;
  // Null when the URL doesn't say; the page falls back to the device's choice.
  view: BookingsView | null;
  // Monday of the shown week; null is the current week.
  week: string | null;
  page: number;
};

export const KINDS: readonly BookingKind[] = ["regular", "evaluation"];
export const STATUSES: readonly BookingStatus[] = [
  "pending",
  "confirmed",
  "completed",
  "didnt_happen",
  "cancelled",
];
const VIEWS: readonly BookingsView[] = ["list", "calendar"];
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const ON = "1";
// A link can't fan out into hundreds of requests or a huge query string.
const MAX_IDS = 20;

export const BOOKINGS_PARAMS = [
  "q",
  "kind",
  "staff",
  "child",
  "status",
  "mine",
  "needs_attention",
  "view",
  "week",
  "page",
] as const;

function pickAll<T extends string>(
  values: string[],
  allowed: readonly T[],
): T[] {
  return allowed.filter((value) => values.includes(value));
}

function readPage(raw: string | null): number {
  const page = Number(raw);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

function readIds(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .filter((id) => id !== "")
    .slice(0, MAX_IDS);
}

export function readBookingsUrl(params: URLSearchParams): BookingsUrlState {
  const view = params.get("view");
  const week = params.get("week");
  return {
    q: params.get("q") ?? "",
    kinds: pickAll(params.getAll("kind"), KINDS),
    staffIds: readIds(params, "staff"),
    childIds: readIds(params, "child"),
    statuses: pickAll(params.getAll("status"), STATUSES),
    isMine: params.get("mine") === ON,
    isNeedsAttention: params.get("needs_attention") === ON,
    view: VIEWS.find((item) => item === view) ?? null,
    // A hand-edited or stale day snaps to its week's Monday.
    week: week && DAY_KEY.test(week) ? getWeekStart(week) : null,
    page: readPage(params.get("page")),
  };
}

// Keeps any params the page doesn't own.
export function writeBookingsUrl(
  current: URLSearchParams,
  state: BookingsUrlState,
): URLSearchParams {
  const next = new URLSearchParams(current);
  BOOKINGS_PARAMS.forEach((key) => next.delete(key));
  if (state.q) next.set("q", state.q);
  state.kinds.forEach((kind) => next.append("kind", kind));
  state.staffIds.forEach((id) => next.append("staff", id));
  state.childIds.forEach((id) => next.append("child", id));
  state.statuses.forEach((status) => next.append("status", status));
  if (state.isMine) next.set("mine", ON);
  if (state.isNeedsAttention) next.set("needs_attention", ON);
  if (state.view) next.set("view", state.view);
  if (state.week) next.set("week", state.week);
  if (state.page > 1) next.set("page", String(state.page));
  return next;
}
