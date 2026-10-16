// Time off for Admins (#191): everyone's Time off in Pending · Upcoming ·
// Past, a table on desktop that collapses to rows on phone. Rows only
// open the details, where Approve / Decline / Cancel live. Add time off
// enters it for anyone, the Admin included, in effect straight away.
import { useState } from "react";
import type { ReactNode } from "react";
import { CalendarX2, Plane, Plus } from "lucide-react";
import { pluralize } from "@/pages/prototype/shell-kit/kit/format";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { DataTable } from "@/pages/prototype/shell-kit/kit/components/data-table";
import type { Column } from "@/pages/prototype/shell-kit/kit/components/data-table";
import { MultiSelectFilter } from "@/pages/prototype/shell-kit/kit/components/multi-select-filter";
import { SubPageTabs } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { useFilters } from "@/pages/prototype/shell-kit/kit/hooks/use-filters";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { PageToolbar } from "@/pages/prototype/shell-kit/kit/shell/page-toolbar";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/pages/prototype/shell-kit/kit/states/states";
import OpenQuestion from "@/pages/prototype/tutor-timeoff/components/open-question";
import TimeOffDetail from "@/pages/prototype/tutor-timeoff/components/time-off-detail";
import TimeOffFormSheet from "@/pages/prototype/tutor-timeoff/components/time-off-form-sheet";
import { TimeOffStatusBadge } from "@/pages/prototype/tutor-timeoff/components/time-off-status";
import {
  formatLength,
  formatStamp,
  formatTimeOffDates,
  ROLE_LABEL,
} from "@/pages/prototype/tutor-timeoff/lib/labels";
import { compareByStart, getQueueTab } from "@/pages/prototype/tutor-timeoff/lib/rules";
import type { QueueTab } from "@/pages/prototype/tutor-timeoff/lib/rules";
import type { AreaStore } from "@/pages/prototype/tutor-timeoff/hooks/use-area-store";
import type { Phase } from "@/pages/prototype/tutor-timeoff/hooks/use-load-phase";
import type { ExceptionRead } from "@/pages/prototype/tutor-timeoff/types/api";

const EMPTY_COPY: Record<QueueTab, { title: string; body: string }> = {
  pending: {
    title: "Nothing to review",
    body: "New requests from Tutors and Managers land here and in To do on Home.",
  },
  upcoming: {
    title: "No time off coming up",
    body: "Approved time off shows here until it’s over.",
  },
  past: {
    title: "No past time off",
    body: "Time off moves here once it’s over, declined, cancelled or expired.",
  },
};

const ROLE_OPTIONS = [
  { value: "tutor", label: "Tutors" },
  { value: "manager", label: "Managers" },
  { value: "admin", label: "Admins" },
];

function ClashCount({ item }: { item: ExceptionRead }): ReactNode {
  const count = item.clashing_bookings_count;
  return count > 0 ? (
    <span className="inline-flex items-center gap-1.5 font-medium text-(--tl-warning)">
      <CalendarX2 aria-hidden className="size-4" />
      {pluralize(count, "Booking", "Bookings")}
    </span>
  ) : (
    <span className="text-(--tl-muted)">None</span>
  );
}

function getColumns(tab: QueueTab): Column<ExceptionRead>[] {
  return [
    {
      id: "who",
      header: "Who",
      width: "26%",
      render: (item) => (
        <span className="flex items-center gap-3">
          <Avatar name={item.staff.name} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold">{item.staff.name}</span>
            <span className="block text-[13px] text-(--tl-muted)">{ROLE_LABEL[item.staff.role]}</span>
          </span>
        </span>
      ),
    },
    {
      id: "when",
      header: "When",
      render: (item) => (
        <span className="tabular-nums">
          <span className="block font-medium">{formatTimeOffDates(item)}</span>
          <span className="block text-[13px] text-(--tl-muted)">{formatLength(item)}</span>
        </span>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      isWideOnly: true,
      render: (item) => item.reason ?? <span className="text-(--tl-muted)">None given</span>,
    },
    {
      id: "clashes",
      header: "In these dates",
      render: (item) =>
        item.status === "pending" || item.status === "approved" ? <ClashCount item={item} /> : "—",
    },
    tab === "pending"
      ? { id: "asked", header: "Asked", isWideOnly: true, render: (item) => formatStamp(item.created_at) }
      : { id: "status", header: "Status", render: (item) => <TimeOffStatusBadge status={item.status} /> },
  ];
}

type TimeOffQueueScreenProps = {
  store: AreaStore;
  phase: Phase;
  isRetrying: boolean;
  onRetry: () => void;
  initialOpenId: string | null;
  isFormInitiallyOpen: boolean;
};

export default function TimeOffQueueScreen({
  store,
  phase,
  isRetrying,
  onRetry,
  initialOpenId,
  isFormInitiallyOpen,
}: TimeOffQueueScreenProps): ReactNode {
  const [tab, setTab] = useState<QueueTab>("pending");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [isFormOpen, setIsFormOpen] = useState(isFormInitiallyOpen);
  const filters = useFilters({ role: [] as string[] });
  const needle = query.trim().toLowerCase();
  const matching = store.timeOff.filter(
    (item) =>
      filters.matches("role", item.staff.role) &&
      (needle === "" || item.staff.name.toLowerCase().includes(needle)),
  );
  const inTab = (which: QueueTab): ExceptionRead[] =>
    matching.filter((item) => getQueueTab(item) === which);
  const visible =
    tab === "past" ? inTab("past").sort((a, b) => compareByStart(b, a)) : inTab(tab).sort(compareByStart);
  const isFiltered = needle !== "" || filters.activeCount > 0;

  let content: ReactNode = (
    <DataTable
      caption={`Time off, ${tab}`}
      rows={visible}
      columns={getColumns(tab)}
      getRowId={(item) => item.id}
      getRowTitle={(item) => `${item.staff.name}, ${formatTimeOffDates(item)}`}
      isRowMuted={(item) => item.status === "cancelled" || item.status === "expired"}
      onOpenRow={(item) => setOpenId(item.id)}
      getPhoneRow={(item) => ({
        leading: <Avatar name={item.staff.name} />,
        title: item.staff.name,
        subtitle: formatTimeOffDates(item),
        meta:
          item.clashing_bookings_count > 0
            ? `${pluralize(item.clashing_bookings_count, "Booking", "Bookings")} in these dates`
            : (item.reason ?? formatLength(item)),
        trailing: tab === "pending" ? undefined : <TimeOffStatusBadge status={item.status} />,
      })}
    />
  );
  if (phase === "loading") {
    content = <TableSkeleton rows={4} columns={5} label="Loading time off" />;
  } else if (phase === "error") {
    content = (
      <ErrorState
        title="Couldn’t load time off"
        body="Check your connection and try again."
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  } else if (visible.length === 0) {
    content = isFiltered ? (
      <EmptyState icon={Plane} tone="yellow" title="No matches" body="Nothing in this tab matches your search or filters." />
    ) : (
      <EmptyState icon={Plane} tone="yellow" {...EMPTY_COPY[tab]} />
    );
  }

  return (
    <>
      <PageHeader
        title="Time off"
        description="Only Admins approve or decline. Time off you add takes effect straight away."
        primaryAction={{ label: "Add time off", icon: Plus, onClick: () => setIsFormOpen(true) }}
        tabs={
          <SubPageTabs
            label="Time off sections"
            activeId={tab}
            // Ids come from the three items below.
            onChange={(id) => setTab(id as QueueTab)}
            items={[
              { id: "pending", label: "Pending", count: phase === "ready" ? inTab("pending").length : undefined },
              { id: "upcoming", label: "Upcoming" },
              { id: "past", label: "Past" },
            ]}
          />
        }
      >
        <PageToolbar
          searchLabel="Search time off by name"
          searchPlaceholder="Search by name"
          query={query}
          onQueryChange={setQuery}
          activeFilterCount={filters.activeCount}
          onClearFilters={filters.clearAll}
          filters={
            <MultiSelectFilter
              label="Role"
              options={ROLE_OPTIONS}
              selected={filters.selected.role}
              onChange={(values) => filters.set("role", values)}
            />
          }
        />
      </PageHeader>
      {tab === "past" && phase === "ready" && (
        <p className="mb-3 flex items-center gap-2 px-1 text-[14px] text-(--tl-muted)">
          Declined, cancelled and expired requests sit here, even when their dates are still ahead.
          <OpenQuestion question="Where do declined or cancelled requests whose dates are still ahead go: Past (as now), Upcoming with their status, or a fourth tab?" />
        </p>
      )}
      {content}
      <TimeOffDetail
        item={store.timeOff.find((item) => item.id === openId) ?? null}
        store={store}
        backLabel="Time off"
        onClose={() => setOpenId(null)}
      />
      <TimeOffFormSheet
        isOpen={isFormOpen}
        mode="add"
        me={store.me}
        staff={store.staff}
        onClose={() => setIsFormOpen(false)}
        onSubmit={store.createTimeOff}
        onCreated={(item) => {
          setIsFormOpen(false);
          setTab(getQueueTab(item));
          setOpenId(item.id);
        }}
      />
    </>
  );
}
