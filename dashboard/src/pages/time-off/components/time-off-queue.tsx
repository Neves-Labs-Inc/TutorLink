// Time off for Admins (and Developers): everyone's Time off in Pending ·
// Upcoming · Declined & cancelled · Past, searchable by name and
// filterable by role, 25 to a page. Add time off enters it for anyone,
// in effect straight away.
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Plane, Plus, SearchX } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { MultiSelectFilter } from "@/components/kit/components/multi-select-filter";
import { Pager } from "@/components/kit/components/pager";
import { SubPageTabs } from "@/components/kit/components/tabs";
import { PageHeader } from "@/components/kit/shell/page-header";
import { PageToolbar } from "@/components/kit/shell/page-toolbar";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/kit/states/states";
import type { ExceptionRead } from "@/lib/queries/time-off";
import TimeOffFormSheet from "@/pages/time-off/components/time-off-form-sheet";
import TimeOffTable from "@/pages/time-off/components/time-off-table";
import {
  getTabSearch,
  QUEUE_PAGE_SIZE,
  QUEUE_TABS,
  ROLE_OPTIONS,
  useTimeOffQueue,
} from "@/pages/time-off/hooks/use-time-off-queue";
import { getQueueTab } from "@/pages/time-off/lib/time-off-rules";
import type { QueueTab, Viewer } from "@/pages/time-off/lib/time-off-rules";

const TABLE_COLUMNS = 5;

const EMPTY_TITLES: Record<QueueTab, string> = {
  pending: "Nothing to review",
  upcoming: "No time off coming up",
  "declined-cancelled": "Nothing declined or cancelled ahead",
  past: "No past time off",
};

type TimeOffQueueProps = {
  viewer: Viewer;
  // Opens one Time off over the list at `search` (the list's URL state).
  onOpen: (id: string, search?: string) => void;
};

export default function TimeOffQueue({ viewer, onOpen }: TimeOffQueueProps): ReactNode {
  const queue = useTimeOffQueue();
  const [search] = useSearchParams();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const tableTopRef = useRef<HTMLDivElement>(null);
  const tabLabel = QUEUE_TABS.find((tab) => tab.id === queue.tab)?.label ?? "";

  function handlePageChange(page: number): void {
    queue.setPage(page);
    const isReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    tableTopRef.current?.scrollIntoView({
      block: "start",
      behavior: isReduced ? "auto" : "smooth",
    });
  }

  // The new item opens in the tab it belongs in.
  function handleCreated(item: ExceptionRead): void {
    setIsFormOpen(false);
    onOpen(item.id, getTabSearch(search, getQueueTab(item)));
  }

  let body: ReactNode;
  if (queue.hasFailed) {
    body = (
      <ErrorState
        title="Couldn’t load time off"
        body="Check your connection and try again."
        onRetry={queue.retry}
        isRetrying={queue.isRetrying}
      />
    );
  } else if (queue.rows === undefined) {
    body = <TableSkeleton columns={TABLE_COLUMNS} label="Loading time off" />;
  } else if (queue.rows.length === 0 && queue.isNarrowed) {
    body = (
      <EmptyState
        icon={SearchX}
        title="No time off matches"
        body="Try another name, or clear the filters."
      />
    );
  } else if (queue.rows.length === 0) {
    body = <EmptyState icon={Plane} tone="yellow" title={EMPTY_TITLES[queue.tab]} />;
  } else {
    body = (
      <>
        <TimeOffTable
          tab={queue.tab}
          tabLabel={tabLabel}
          rows={queue.rows}
          onOpen={(item) => onOpen(item.id)}
        />
        <div className="mt-4">
          <Pager
            page={queue.page}
            pageSize={QUEUE_PAGE_SIZE}
            total={queue.total}
            onPageChange={handlePageChange}
            label="Time off pages"
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Time off"
        description="Only Admins approve or decline. Time off you add takes effect straight away."
        primaryAction={{
          label: "Add time off",
          icon: Plus,
          onClick: () => setIsFormOpen(true),
        }}
        tabs={
          <SubPageTabs
            label="Time off sections"
            activeId={queue.tab}
            // Ids come from QUEUE_TABS.
            onChange={(id) => queue.changeTab(id as QueueTab)}
            items={QUEUE_TABS.map((tab) => ({
              ...tab,
              count: tab.id === "pending" ? queue.pendingCount : undefined,
            }))}
          />
        }
      >
        <PageToolbar
          searchLabel="Search time off by name"
          searchPlaceholder="Search by name"
          query={queue.query}
          onQueryChange={queue.setQuery}
          activeFilterCount={queue.roles.length > 0 ? 1 : 0}
          onClearFilters={queue.clearFilters}
          filters={
            <MultiSelectFilter
              label="Role"
              options={ROLE_OPTIONS}
              selected={queue.roles}
              onChange={queue.setRoles}
            />
          }
        />
      </PageHeader>
      <div ref={tableTopRef} className="scroll-mt-4">
        {body}
      </div>
      <TimeOffFormSheet
        isOpen={isFormOpen}
        mode="add"
        viewer={viewer}
        onClose={() => setIsFormOpen(false)}
        onCreated={handleCreated}
      />
    </>
  );
}
