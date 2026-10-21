// Time off lists in order: the Admin queue's tabs and a Tutor's or
// Manager's own sections. Placement is `time-off-rules`; this sorts and
// groups what those rules place.
import type { ExceptionRead } from "@/lib/queries/time-off";
import { getOwnSection } from "@/pages/time-off/lib/time-off-rules";
import type { OwnSection, QueueTab } from "@/pages/time-off/lib/time-off-rules";

type Compare = (a: ExceptionRead, b: ExceptionRead) => number;

// The id breaks ties, so a page never reshuffles between reads.
function compareIds(a: ExceptionRead, b: ExceptionRead): number {
  return a.id.localeCompare(b.id);
}

// Oldest asked first.
const byAsked: Compare = (a, b) =>
  a.created_at.localeCompare(b.created_at) || compareIds(a, b);

// Soonest first; a whole day starts before any part of it.
const byStart: Compare = (a, b) =>
  a.start_date.localeCompare(b.start_date) ||
  (a.start_time ?? "").localeCompare(b.start_time ?? "") ||
  compareIds(a, b);

const byMostRecent: Compare = (a, b) => byStart(b, a);

const QUEUE_ORDER: Record<QueueTab, Compare> = {
  pending: byAsked,
  upcoming: byStart,
  "declined-cancelled": byStart,
  past: byMostRecent,
};

const OWN_ORDER: Record<OwnSection, Compare> = {
  waiting: byStart,
  coming: byStart,
  "declined-cancelled": byStart,
  history: byMostRecent,
};

const OWN_SECTIONS: OwnSection[] = ["waiting", "coming", "declined-cancelled", "history"];

export function sortQueueTab(items: ExceptionRead[], tab: QueueTab): ExceptionRead[] {
  return items.toSorted(QUEUE_ORDER[tab]);
}

export type OwnGroup = { section: OwnSection; items: ExceptionRead[] };

// The own list's sections in page order, empty ones left out.
export function groupOwnTimeOff(items: ExceptionRead[], now: string): OwnGroup[] {
  return OWN_SECTIONS.map((section) => ({
    section,
    items: items
      .filter((item) => getOwnSection(item, now) === section)
      .toSorted(OWN_ORDER[section]),
  })).filter((group) => group.items.length > 0);
}
