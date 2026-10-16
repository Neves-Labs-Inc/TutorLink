// Staff: Tutors, Managers and Admins with Role, Sign-in and Subject
// filters. Managers see it read-only (no Add staff, Invite or Archive).
import { useState } from "react";
import type { ReactNode } from "react";
import { SearchX, UserPlus } from "lucide-react";
import { STAFF } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Role, Staff } from "@/pages/prototype/shell-kit/kit/mock-data";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { PageToolbar } from "@/pages/prototype/shell-kit/kit/shell/page-toolbar";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { EmptyState } from "@/pages/prototype/shell-kit/kit/states/states";
import FilterDropdowns from "@/pages/prototype/shell-kit/screens/filter-dropdowns";
import { StaffTable } from "@/pages/prototype/shell-kit/screens/people-tables";
import StaffDetail from "@/pages/prototype/shell-kit/screens/staff-detail";
import {
  STAFF_FILTER_FIELDS,
  useStaffFilters,
} from "@/pages/prototype/shell-kit/screens/use-record-filters";

type StaffPageProps = { role: Role };

export default function StaffPage({ role }: StaffPageProps): ReactNode {
  const [query, setQuery] = useState("");
  const [openStaff, setOpenStaff] = useState<Staff | null>(null);
  const filters = useStaffFilters();
  const { showToast } = useToast();
  const isAdmin = role === "admin";
  const rows = filters
    .apply(STAFF)
    .filter((staff) => staff.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone a Booking can be with: Tutors, Managers and Admins."
        primaryAction={
          isAdmin
            ? {
                label: "Add staff",
                icon: UserPlus,
                onClick: () =>
                  showToast({ tone: "info", message: "Add staff opens a form." }),
              }
            : undefined
        }
      >
        <PageToolbar
          searchLabel="Search Staff"
          searchPlaceholder="Search by name"
          query={query}
          onQueryChange={setQuery}
          activeFilterCount={filters.activeCount}
          onClearFilters={filters.clearAll}
          filters={
            <FilterDropdowns
              fields={STAFF_FILTER_FIELDS}
              selected={filters.selected}
              onChange={filters.set}
            />
          }
        />
      </PageHeader>
      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No Staff match"
          body="Try another name, or clear the filters."
          action={
            <Button
              onClick={() => {
                setQuery("");
                filters.clearAll();
              }}
            >
              Clear search and filters
            </Button>
          }
        />
      ) : (
        <StaffTable rows={rows} onOpen={setOpenStaff} />
      )}
      <StaffDetail
        staff={openStaff}
        onClose={() => setOpenStaff(null)}
        phoneMode="page"
        canManage={isAdmin}
      />
    </>
  );
}
