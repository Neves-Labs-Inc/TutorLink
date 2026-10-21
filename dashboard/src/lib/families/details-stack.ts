// The details stack on the family page (Child → Guardian → …). The URL
// names the top record (?child= / ?guardian=); the entries below it ride
// in history state, one history entry per open, so browser back closes
// the top overlay.
import type { DetailEntry } from "@/lib/families/family-paths";

export type DetailsStackState = { familyDetails: DetailEntry[] };

function isDetailEntry(value: unknown): value is DetailEntry {
  if (typeof value !== "object" || value === null) return false;

  const { kind, id } = value as Record<string, unknown>;
  return (kind === "child" || kind === "guardian") && typeof id === "string";
}

// History state is whatever the last navigation left, so check it.
export function readDetailsStack(state: unknown): DetailEntry[] | null {
  if (typeof state !== "object" || state === null) return null;

  const entries = (state as Record<string, unknown>).familyDetails;
  const isStack = Array.isArray(entries) && entries.every(isDetailEntry);
  return isStack ? entries : null;
}

export function isSameEntry(a: DetailEntry | undefined, b: DetailEntry): boolean {
  return a !== undefined && a.kind === b.kind && a.id === b.id;
}

export type ResolvedStack = {
  stack: DetailEntry[];
  // The URL opened a record with no stack behind it: a link from
  // elsewhere, or a reload.
  isDeepLink: boolean;
};

export function resolveDetailsStack(
  top: DetailEntry | null,
  saved: DetailEntry[] | null,
): ResolvedStack {
  if (top === null) return { stack: [], isDeepLink: false };

  const isSaved = saved !== null && isSameEntry(saved.at(-1), top);
  return isSaved
    ? { stack: saved, isDeepLink: false }
    : { stack: [top], isDeepLink: true };
}

// The overlays to keep mounted: the open stack, then entries just popped
// (closed, playing their exit) in the slots above it.
export function keepClosingSlots(
  previous: DetailEntry[],
  stack: DetailEntry[],
): DetailEntry[] {
  return [...stack, ...previous.slice(stack.length)];
}
