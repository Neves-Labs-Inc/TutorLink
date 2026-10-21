// One Staff member for details, and the tab in `?tab=` (it survives a
// reload). An unknown tab, or one this person doesn't have, falls back
// to Overview and the URL is corrected in place.
import { useEffect } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router-dom";
import { isStaffMissing, staffDirectoryQueries } from "@/lib/queries/staff";
import type { StaffRead } from "@/lib/queries/staff";
import { getStaffTabs } from "@/pages/staff/lib/staff-labels";
import type { StaffTab, StaffTabItem } from "@/pages/staff/lib/staff-labels";

const TAB_PARAM = "tab";
const DEFAULT_TAB: StaffTab = "overview";

type StaffDetails = {
  staff: StaffRead | undefined;
  isLoading: boolean;
  isNotFound: boolean;
  hasFailed: boolean;
  isRetrying: boolean;
  retry: () => void;
  tabs: StaffTabItem[];
  tab: StaffTab;
  changeTab: (tab: StaffTab) => void;
};

export function useStaffDetails(staffId: string | undefined): StaffDetails {
  const [search, setSearch] = useSearchParams();
  // Kept across tab changes: it says whether details were opened from the list.
  const { state } = useLocation();
  const detail = useQuery({
    ...staffDirectoryQueries.detail(staffId ?? ""),
    enabled: staffId !== undefined,
    // Closing keeps the last member up while the panel plays its exit.
    placeholderData: staffId === undefined ? keepPreviousData : undefined,
  });
  const staff = detail.data;
  const tabs = staff ? getStaffTabs(staff) : [];
  const requested = search.get(TAB_PARAM);
  const tab = tabs.find((item) => item.id === requested)?.id ?? DEFAULT_TAB;
  const isUnavailable =
    staff !== undefined && requested !== null && requested !== tab;
  const isNotFound = isStaffMissing(detail.error);
  // v5 resets a failed query to pending while it retries; the error stays up meanwhile.
  const hasFailed =
    !staff && !isNotFound && (detail.isError || detail.errorUpdateCount > 0);

  function changeTab(next: StaffTab): void {
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === DEFAULT_TAB) params.delete(TAB_PARAM);
        else params.set(TAB_PARAM, next);
        return params;
      },
      { replace: true, state },
    );
  }

  useEffect(() => {
    if (!isUnavailable) return;
    setSearch(
      (current) => {
        const params = new URLSearchParams(current);
        params.delete(TAB_PARAM);
        return params;
      },
      { replace: true, state },
    );
  }, [isUnavailable, setSearch, state]);

  return {
    staff,
    isLoading: staffId !== undefined && detail.isPending && !hasFailed && !isNotFound,
    isNotFound,
    hasFailed,
    isRetrying: detail.isFetching,
    retry: () => void detail.refetch(),
    tabs,
    tab,
    changeTab,
  };
}
