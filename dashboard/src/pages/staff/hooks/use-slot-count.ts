// How many active Availability slots a teaching profile has, for the
// setup checklist. Shares the Availability tab's read, so a save there
// updates the checklist too.
import { useQuery } from "@tanstack/react-query";
import { availabilityWeekQueries } from "@/lib/queries/availability-week";
import type { SlotCount } from "@/pages/staff/lib/setup-checklist";

export function useSlotCount(
  tutorId: string | null,
  isEnabled: boolean,
): SlotCount {
  const query = useQuery({
    ...availabilityWeekQueries.forTutor(tutorId ?? ""),
    enabled: isEnabled && tutorId !== null,
  });
  let count: SlotCount = "loading";
  if (query.data) {
    count = query.data.items.filter((slot) => slot.is_active).length;
  } else if (query.isError) {
    count = "failed";
  }
  return count;
}
