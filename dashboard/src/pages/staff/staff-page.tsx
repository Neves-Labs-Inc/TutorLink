// Staff (`/staff`, `/staff/:id`; replaces Users and Tutors): Staff |
// Archived tabs, search, Role and Sign-in state filters, and details
// over the list. Admins add Staff; Managers only view. Developers are
// never listed.
import { useState } from "react";
import type { ReactNode } from "react";
import { Archive, Eye, SearchX, UserPlus } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { MultiSelectFilter } from "@/components/kit/components/multi-select-filter";
import { SubPageTabs } from "@/components/kit/components/tabs";
import { PageHeader } from "@/components/kit/shell/page-header";
import { PageToolbar } from "@/components/kit/shell/page-toolbar";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/kit/states/states";
import AddStaffSheet from "@/pages/staff/components/add-staff-sheet";
import StaffDetails from "@/pages/staff/components/staff-details";
import StaffTable from "@/pages/staff/components/staff-table";
import {
  ROLE_OPTIONS,
  SIGN_IN_OPTIONS,
  useStaffList,
} from "@/pages/staff/hooks/use-staff-list";
import type { StaffListTab } from "@/pages/staff/hooks/use-staff-list";
import { useAuthStore } from "@/stores/authStore";

const STAFF_PATH = "/staff";

// Set on details opened from a row, so closing steps Back to the list
// instead of stacking a second list entry that Back would reopen from.
type DetailsState = { isFromList?: boolean } | null;
const TABLE_COLUMNS = 4;

export default function StaffPage(): ReactNode {
  const navigate = useNavigate();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const { id: staffId } = useParams();
  // Router state is whatever the last navigation set; ours is DetailsState.
  const locationState = useLocation().state as DetailsState;
  const viewerRole = useAuthStore((state) => state.role);
  const viewerId = useAuthStore((state) => state.userId);
  const list = useStaffList();
  // The route guard has already settled an Office role.
  if (viewerRole === null) return null;

  const isAdmin = viewerRole === "admin" || viewerRole === "developer";

  function handleCloseDetails(): void {
    if (locationState?.isFromList) {
      navigate(-1);
    } else {
      navigate(`${STAFF_PATH}${list.listSearch}`, { replace: true });
    }
  }
  const isArchivedTab = list.tab === "archived";

  let body: ReactNode;
  if (list.hasFailed) {
    body = (
      <ErrorState
        title="Couldn’t load Staff"
        body="Check your connection and try again."
        onRetry={list.retry}
        isRetrying={list.isRetrying}
      />
    );
  } else if (list.rows === undefined) {
    body = <TableSkeleton columns={TABLE_COLUMNS} label="Loading Staff" />;
  } else if (list.rows.length === 0 && list.isNarrowed) {
    body = (
      <EmptyState
        icon={SearchX}
        title="No Staff match"
        body="Try another name, or clear the filters."
      />
    );
  } else if (list.rows.length === 0 && isArchivedTab) {
    body = <EmptyState icon={Archive} title="No archived Staff" />;
  } else {
    body = (
      <StaffTable
        rows={list.rows}
        onOpen={(staff) =>
          navigate(`${STAFF_PATH}/${staff.id}${list.listSearch}`, {
            state: { isFromList: true },
          })
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Staff"
        description={
          isAdmin ? (
            "Everyone a Booking can be with: Tutors, Managers and Admins."
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <Eye aria-hidden className="size-4 shrink-0" />
              View only. Admins add and change Staff.
            </span>
          )
        }
        primaryAction={
          isAdmin
            ? {
                label: "Add staff",
                icon: UserPlus,
                onClick: () => setIsAddOpen(true),
              }
            : undefined
        }
        tabs={
          <SubPageTabs
            label="Staff lists"
            activeId={list.tab}
            // Ids come from the two items below.
            onChange={(id) => list.changeTab(id as StaffListTab)}
            items={[
              { id: "current", label: "Staff", count: list.counts.current },
              {
                id: "archived",
                label: "Archived",
                count: list.counts.archived,
              },
            ]}
          />
        }
      >
        <PageToolbar
          searchLabel="Search Staff"
          searchPlaceholder="Search by name"
          query={list.query}
          onQueryChange={list.setQuery}
          activeFilterCount={list.activeFilterCount}
          onClearFilters={list.clearFilters}
          filters={
            <>
              <MultiSelectFilter
                label="Role"
                options={ROLE_OPTIONS}
                selected={list.roles}
                onChange={list.setRoles}
              />
              <MultiSelectFilter
                label="Sign-in state"
                options={SIGN_IN_OPTIONS}
                selected={list.signInStates}
                onChange={list.setSignInStates}
              />
            </>
          }
        />
      </PageHeader>
      {body}
      <StaffDetails
        staffId={staffId}
        backLabel={isArchivedTab ? "Archived" : "Staff"}
        viewerRole={viewerRole}
        viewerId={viewerId ?? ""}
        onClose={handleCloseDetails}
      />
      {isAdmin && (
        <AddStaffSheet isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} />
      )}
    </>
  );
}
