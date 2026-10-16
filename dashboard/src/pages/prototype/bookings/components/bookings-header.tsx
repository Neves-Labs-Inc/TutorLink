// Bookings header: title, counts, New booking, then the kit toolbar
// (search, Mine for Managers, one dropdown per field, List / Calendar),
// then the week stepper that both views share (and Week / Day in the
// calendar).
import type { ReactNode } from "react";
import {
  CalendarDays,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  List,
  Plus,
  UserRound,
} from "lucide-react";
import { Button, IconButton } from "@/components/kit/components/button";
import { QuickFilter } from "@/components/kit/components/quick-filter";
import { SegmentedControl } from "@/components/kit/components/tabs";
import { PageHeader } from "@/components/kit/shell/page-header";
import { PageToolbar } from "@/components/kit/shell/page-toolbar";
import OpenQuestion from "@/pages/prototype/bookings/components/open-question";
import FilterDropdowns from "@/pages/prototype/shared/filter-dropdowns";
import type { BookingsPageState } from "@/pages/prototype/bookings/hooks/use-bookings-page";
import { STAFF, WEEK_START } from "@/pages/prototype/bookings/lib/mock-data";
import { formatWeekRange, pluralize } from "@/pages/prototype/bookings/lib/format";

const FILTER_FIELDS = [
  {
    key: "kind",
    label: "Kind",
    options: [
      { value: "regular", label: "Tutoring" },
      { value: "evaluation", label: "Evaluation" },
    ],
  },
  {
    key: "staff",
    label: "Staff",
    options: STAFF.map((staff) => ({
      value: staff.id,
      label: staff.archived ? `${staff.name} (archived)` : staff.name,
    })),
  },
  {
    key: "status",
    label: "Status",
    options: [
      { value: "confirmed", label: "Confirmed" },
      { value: "completed", label: "Completed" },
      { value: "cancelled", label: "Cancelled" },
    ],
  },
] as const;

type BookingsHeaderProps = { state: BookingsPageState };

export default function BookingsHeader({ state }: BookingsHeaderProps): ReactNode {
  const { page, filters } = state;
  const isThisWeek = state.weekStart === WEEK_START;
  const activeCount =
    filters.activeCount + (state.isMineOnly ? 1 : 0) + (state.isAttentionOnly ? 1 : 0);
  const isAllDates = state.isAttentionOnly && state.view === "list";
  const description =
    state.dataState === "ready"
      ? `${pluralize(page.total, "booking", "bookings")} ${isAllDates ? "need attention" : isThisWeek ? "this week" : "that week"}${page.counts_by_kind.evaluation > 0 ? `, ${pluralize(page.counts_by_kind.evaluation, "Evaluation", "Evaluations")}` : ""}.`
      : undefined;

  return (
    <PageHeader
      title="Bookings"
      description={description}
      primaryAction={{ label: "New booking", icon: Plus, onClick: () => state.openNew() }}
    >
      <PageToolbar
        searchLabel="Search bookings"
        searchPlaceholder="Search a Child or Staff"
        query={state.search}
        onQueryChange={state.setSearch}
        activeFilterCount={activeCount}
        onClearFilters={state.clearFilters}
        filters={
          <>
            <QuickFilter
              label="Needs attention"
              icon={CircleAlert}
              isOn={state.isAttentionOnly}
              onToggle={() => state.setIsAttentionOnly(!state.isAttentionOnly)}
            />
            <OpenQuestion question="Home’s To do “See all” for Bookings lands on this filter. Keep it, or drop it and have no landing at all?" />
            {state.role === "manager" && (
              <QuickFilter
                label="Mine"
                icon={UserRound}
                isOn={state.isMineOnly}
                onToggle={() => state.setIsMineOnly(!state.isMineOnly)}
              />
            )}
            <FilterDropdowns
              fields={FILTER_FIELDS}
              selected={filters.selected}
              onChange={filters.set}
            />
          </>
        }
        view={
          <SegmentedControl
            label="Bookings view"
            activeId={state.view === "calendar" ? "calendar" : "list"}
            onChange={(id) => state.setView(id === "calendar" ? "calendar" : "list")}
            items={[
              { id: "list", label: "List", icon: List },
              { id: "calendar", label: "Calendar", icon: CalendarDays },
            ]}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        {isAllDates ? (
          <p className="kit-display flex min-h-11 items-center px-1 text-[17px] font-bold">
            All dates · needing attention
          </p>
        ) : (
        <div className="flex items-center">
          <IconButton icon={ChevronLeft} label="Previous week" onClick={() => state.moveWeek(-1)} />
          <span className="kit-display min-w-[132px] text-center text-[17px] font-bold tabular-nums">
            {formatWeekRange(state.weekStart)}
          </span>
          <IconButton icon={ChevronRight} label="Next week" onClick={() => state.moveWeek(1)} />
        </div>
        )}
        {!isThisWeek && !isAllDates && (
          <Button variant="ghost" onClick={state.goToToday}>
            This week
          </Button>
        )}
        {state.view === "calendar" && (
          <div className="ml-auto hidden @3xl:block">
            <SegmentedControl
              label="Calendar scale"
              activeId={state.scale}
              onChange={(id) => state.setScale(id === "day" ? "day" : "week")}
              items={[
                { id: "week", label: "Week" },
                { id: "day", label: "Day · by Staff" },
              ]}
            />
          </div>
        )}
      </div>
    </PageHeader>
  );
}
