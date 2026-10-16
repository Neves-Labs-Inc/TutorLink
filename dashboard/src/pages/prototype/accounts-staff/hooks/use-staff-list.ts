// Staff list state: the Archived tab, search, and one multi-select per
// field (Role, Sign-in state), read from GET /api/staff?archived=.
import { useState } from "react";
import type { FilterOption } from "@/components/kit/components/multi-select-filter";
import { useFilters } from "@/components/kit/hooks/use-filters";
import type { StaffRow } from "@/pages/prototype/accounts-staff/components/staff-table";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  hasPendingTimeOff,
  listStaff,
} from "@/pages/prototype/accounts-staff/lib/mock-api";

export type StaffTab = "current" | "archived";

export const STAFF_FILTERS = [
  {
    key: "role",
    label: "Role",
    options: [
      { value: "tutor", label: "Tutors" },
      { value: "manager", label: "Managers" },
      { value: "admin", label: "Admins" },
    ] satisfies FilterOption[],
  },
  {
    key: "signIn",
    label: "Sign-in state",
    options: [
      { value: "not_invited", label: "Not invited" },
      { value: "invited", label: "Invited" },
      { value: "active", label: "Active" },
    ] satisfies FilterOption[],
  },
] as const;

type StaffList = {
  tab: StaffTab;
  changeTab: (tab: StaffTab) => void;
  query: string;
  setQuery: (query: string) => void;
  filters: ReturnType<typeof useFilters<"role" | "signIn">>;
  rows: StaffRow[];
  counts: Record<StaffTab, number>;
  isNarrowed: boolean;
  clearAll: () => void;
};

export function useStaffList(initialTab: StaffTab): StaffList {
  const { db } = useArea();
  const [tab, setTab] = useState<StaffTab>(initialTab);
  const [query, setQuery] = useState("");
  const filters = useFilters<"role" | "signIn">({ role: [], signIn: [] });
  const needle = query.trim().toLowerCase();

  const rows = listStaff(db, tab === "archived")
    .filter(
      (staff) =>
        staff.name.toLowerCase().includes(needle) &&
        filters.matches("role", staff.role) &&
        filters.matches("signIn", staff.sign_in_state),
    )
    .map((staff) => ({ ...staff, hasPendingTimeOff: hasPendingTimeOff(db, staff.id) }));

  function clearAll(): void {
    setQuery("");
    filters.clearAll();
  }

  return {
    tab,
    changeTab: (next) => {
      setTab(next);
      clearAll();
    },
    query,
    setQuery,
    filters,
    rows,
    counts: {
      current: listStaff(db, false).length,
      archived: listStaff(db, true).length,
    },
    isNarrowed: needle !== "" || filters.activeCount > 0,
    clearAll,
  };
}
