// A Tutor's or Manager's own Time off, read whole (own lists are small)
// and grouped into the page's sections.
import { useQuery } from "@tanstack/react-query";
import { timeOffQueries } from "@/lib/queries/time-off";
import { groupOwnTimeOff } from "@/pages/time-off/lib/time-off-lists";
import type { OwnGroup } from "@/pages/time-off/lib/time-off-lists";
import { getBusinessNow } from "@/pages/time-off/lib/time-off-rules";

export type OwnTimeOff = {
  // Undefined while loading.
  groups: OwnGroup[] | undefined;
  hasFailed: boolean;
  isRetrying: boolean;
  retry: () => void;
};

export function useOwnTimeOff(userId: string): OwnTimeOff {
  const query = useQuery(timeOffQueries.forUserAll(userId));
  return {
    groups: query.data && groupOwnTimeOff(query.data.items, getBusinessNow()),
    // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
    hasFailed: !query.data && (query.isError || query.errorUpdateCount > 0),
    isRetrying: query.isFetching,
    retry: () => void query.refetch(),
  };
}
