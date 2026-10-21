// One person's Time off for the tab: the current page, split into
// Upcoming and History. Newest first, so page 1 holds the latest rows. The previous page stays up while the next loads.
import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { timeOffQueries } from "@/lib/queries/time-off";
import { splitTimeOff } from "@/pages/staff/lib/staff-time-off-sections";
import type { TimeOffSections } from "@/pages/staff/lib/staff-time-off-sections";

export const TIME_OFF_PAGE_SIZE = 25;

type StaffTimeOff = {
  sections: TimeOffSections | undefined;
  total: number;
  page: number;
  setPage: (page: number) => void;
  isPageLoading: boolean;
  hasFailed: boolean;
  isRetrying: boolean;
  retry: () => void;
};

export function useStaffTimeOff(userId: string): StaffTimeOff {
  const [page, setPage] = useState(1);
  const query = useQuery({
    ...timeOffQueries.forUser(userId, { order: "desc", page, page_size: TIME_OFF_PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
  const hasFailed = !query.data && (query.isError || query.errorUpdateCount > 0);

  return {
    sections: query.data ? splitTimeOff(query.data.items) : undefined,
    total: query.data?.total ?? 0,
    page,
    setPage,
    isPageLoading: query.isPlaceholderData,
    hasFailed,
    isRetrying: query.isFetching,
    retry: () => void query.refetch(),
  };
}
