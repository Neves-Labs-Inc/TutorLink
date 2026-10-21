// Splits one page of a person's Time off into the tab's two lists. The
// API pages by start date, oldest first, so a clean split across pages
// isn't possible; each page is split on its own.
import type { ExceptionRead } from "@/lib/queries/time-off";
import { getBusinessNow, hasEnded } from "@/pages/time-off/lib/time-off-rules";

export type TimeOffSections = { upcoming: ExceptionRead[]; history: ExceptionRead[] };

function compareStart(a: ExceptionRead, b: ExceptionRead): number {
  return `${a.start_date}T${a.start_time ?? "00:00:00"}`.localeCompare(
    `${b.start_date}T${b.start_time ?? "00:00:00"}`,
  );
}

export function splitTimeOff(
  items: ExceptionRead[],
  now: string = getBusinessNow(),
): TimeOffSections {
  const upcoming = items.filter((item) => !hasEnded(item, now)).sort(compareStart);
  const history = items.filter((item) => hasEnded(item, now)).sort(compareStart).reverse();
  return { upcoming, history };
}
