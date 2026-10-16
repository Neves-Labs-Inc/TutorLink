// Staff (replaces Users and Tutors): Staff | Archived tabs, search, Role
// and Sign-in filters. Admins add Staff; Managers only view. Developers
// are never listed. Rows open Staff details.
import { useState } from "react";
import type { ReactNode } from "react";
import { Archive, Eye, SearchX, UserPlus } from "lucide-react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { MultiSelectFilter } from "@/pages/prototype/shell-kit/kit/components/multi-select-filter";
import { SubPageTabs } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { PageToolbar } from "@/pages/prototype/shell-kit/kit/shell/page-toolbar";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/pages/prototype/shell-kit/kit/states/states";
import AddStaffSheet from "@/pages/prototype/accounts-staff/components/add-staff-sheet";
import StaffDetails from "@/pages/prototype/accounts-staff/components/staff-details";
import StaffTable from "@/pages/prototype/accounts-staff/components/staff-table";
import { SETUP_STAFF_ID } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  STAFF_FILTERS,
  useStaffList,
} from "@/pages/prototype/accounts-staff/hooks/use-staff-list";
import type { StaffTab } from "@/pages/prototype/accounts-staff/hooks/use-staff-list";
import type {
  OfficeRole,
  Phase,
  Screen,
} from "@/pages/prototype/accounts-staff/types/screens";

const DETAIL_START: Partial<Record<Screen, string>> = {
  "staff-detail": "u-marco",
  "staff-children": "u-marco",
  "staff-setup": SETUP_STAFF_ID,
};

type StaffPageProps = {
  role: OfficeRole;
  phase: Phase;
  onRetry: () => void;
  startScreen: Screen;
  onOpenChild: (childId: string) => void;
};

export default function StaffPage({
  role,
  phase,
  onRetry,
  startScreen,
  onOpenChild,
}: StaffPageProps): ReactNode {
  const isAdmin = role === "admin";
  const list = useStaffList(startScreen === "staff-archived" ? "archived" : "current");
  const [openId, setOpenId] = useState<string | null>(DETAIL_START[startScreen] ?? null);
  const [isAddOpen, setIsAddOpen] = useState(isAdmin && startScreen === "add-staff");
  const isArchivedTab = list.tab === "archived";
  const isReady = phase === "ready";

  let body: ReactNode;
  if (phase === "loading") {
    body = <TableSkeleton columns={4} label="Loading Staff" />;
  } else if (phase === "error") {
    body = (
      <ErrorState
        title="Couldn’t load Staff"
        body="Check your connection and try again. Nothing was changed."
        onRetry={onRetry}
      />
    );
  } else if (list.rows.length === 0 && list.isNarrowed) {
    body = (
      <EmptyState
        icon={SearchX}
        title="No Staff match"
        body="Try another name, or clear the filters."
        action={<Button onClick={list.clearAll}>Clear search and filters</Button>}
      />
    );
  } else if (list.rows.length === 0 && isArchivedTab) {
    body = (
      <EmptyState
        icon={Archive}
        title="No archived Staff"
        body="Archived Staff can’t sign in or be booked. They show up here, ready to Restore."
      />
    );
  } else if (list.rows.length <= 1 && !isArchivedTab) {
    // Only the signed-in Admin: a team of one.
    body = (
      <>
        <StaffTable rows={list.rows} onOpen={(row) => setOpenId(row.id)} />
        <div className="mt-4">
          <EmptyState
            icon={UserPlus}
            title="Just you so far"
            body={
              isAdmin
                ? "Add your Tutors and Managers. Each gets a setup checklist: Subjects, Availability and an Invite."
                : "An Admin adds Tutors and Managers here."
            }
            action={isAdmin ? <Button variant="primary" icon={UserPlus} onClick={() => setIsAddOpen(true)}>Add staff</Button> : undefined}
          />
        </div>
      </>
    );
  } else {
    body = <StaffTable rows={list.rows} onOpen={(row) => setOpenId(row.id)} />;
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
              <Eye aria-hidden className="size-4" /> View only. Admins add and change Staff.
            </span>
          )
        }
        primaryAction={isAdmin ? { label: "Add staff", icon: UserPlus, onClick: () => setIsAddOpen(true) } : undefined}
        tabs={
          <SubPageTabs
            label="Staff lists"
            activeId={list.tab}
            // Ids come from the two items below.
            onChange={(id) => list.changeTab(id as StaffTab)}
            items={[
              { id: "current", label: "Staff", count: isReady ? list.counts.current : undefined },
              { id: "archived", label: "Archived", count: isReady ? list.counts.archived : undefined },
            ]}
          />
        }
      >
        <PageToolbar
          searchLabel="Search Staff"
          searchPlaceholder="Search by name"
          query={list.query}
          onQueryChange={list.setQuery}
          activeFilterCount={list.filters.activeCount}
          onClearFilters={list.filters.clearAll}
          filters={STAFF_FILTERS.map((field) => (
            <MultiSelectFilter
              key={field.key}
              label={field.label}
              options={[...field.options]}
              selected={list.filters.selected[field.key]}
              onChange={(values) => list.filters.set(field.key, values)}
            />
          ))}
        />
      </PageHeader>
      {body}
      {openId && isReady && (
        <StaffDetails
          key={openId}
          staffId={openId}
          role={role}
          initialTab={startScreen === "staff-children" && openId === DETAIL_START["staff-children"] ? "children" : "overview"}
          onOpenChild={onOpenChild}
          backLabel={isArchivedTab ? "Archived" : "Staff"}
          onClose={() => setOpenId(null)}
        />
      )}
      {isAddOpen && (
        <AddStaffSheet
          onClose={() => setIsAddOpen(false)}
          onCreated={(id) => {
            setIsAddOpen(false);
            list.changeTab("current");
            setOpenId(id);
          }}
        />
      )}
    </>
  );
}
