// Search, the Kind / Staff / Status filters, Mine (Managers), Needs
// attention, Clear all and the List / Calendar switch. Needs attention
// hides everything it ignores, leaving only itself and Clear all.
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, CircleAlert, List, UserRound } from "lucide-react";
import { MultiSelectFilter } from "@/components/kit/components/multi-select-filter";
import type { FilterOption } from "@/components/kit/components/multi-select-filter";
import { QuickFilter } from "@/components/kit/components/quick-filter";
import { SegmentedControl } from "@/components/kit/components/tabs";
import { PageToolbar } from "@/components/kit/shell/page-toolbar";
import { staffQueries } from "@/lib/queries/staff";
import type { BookingsUrl } from "@/pages/bookings/hooks/use-bookings-url";
import { useChildOptions } from "@/pages/bookings/hooks/use-child-options";
import { useSearchText } from "@/pages/bookings/hooks/use-search-text";

const KIND_OPTIONS: FilterOption[] = [
  { value: "regular", label: "Tutoring" },
  { value: "evaluation", label: "Evaluation" },
];

const STATUS_OPTIONS: FilterOption[] = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "completed", label: "Completed" },
  { value: "didnt_happen", label: "Didn’t happen" },
  { value: "cancelled", label: "Cancelled" },
];

const VIEW_ITEMS = [
  { id: "list", label: "List", icon: List },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
];

type BookingsToolbarProps = { url: BookingsUrl; isManager: boolean };

export default function BookingsToolbar({
  url,
  isManager,
}: BookingsToolbarProps): ReactNode {
  const { state } = url;
  const search = useSearchText(state.q, url.setQuery);
  const staff = useQuery(staffQueries.active());
  // Shown only when a link brought Children in; unticking removes them.
  const childOptions = useChildOptions(state.childIds);
  const staffOptions: FilterOption[] = (staff.data?.items ?? []).map(
    (member) => ({
      value: member.id,
      label: member.name,
    }),
  );
  const needsAttention = (
    <QuickFilter
      label="Needs attention"
      icon={CircleAlert}
      isOn={state.isNeedsAttention}
      onToggle={url.toggleNeedsAttention}
    />
  );

  return (
    <PageToolbar
      searchLabel="Search bookings"
      searchPlaceholder="Search a Child or Staff"
      query={search.text}
      onQueryChange={search.setText}
      hasSearch={!state.isNeedsAttention}
      activeFilterCount={url.activeCount}
      onClearFilters={url.clearAll}
      filters={
        state.isNeedsAttention ? (
          needsAttention
        ) : (
          <>
            {needsAttention}
            {isManager && (
              <QuickFilter
                label="Mine"
                icon={UserRound}
                isOn={state.isMine}
                onToggle={url.toggleMine}
              />
            )}
            <MultiSelectFilter
              label="Kind"
              options={KIND_OPTIONS}
              selected={state.kinds}
              onChange={url.setKinds}
            />
            {childOptions.length > 0 && (
              <MultiSelectFilter
                label={childOptions.map((option) => option.label).join(", ")}
                options={childOptions}
                selected={state.childIds}
                onChange={url.setChildIds}
              />
            )}
            <MultiSelectFilter
              label="Staff"
              options={staffOptions}
              selected={state.staffIds}
              onChange={url.setStaffIds}
            />
            <MultiSelectFilter
              label="Status"
              options={STATUS_OPTIONS}
              selected={state.statuses}
              onChange={url.setStatuses}
            />
          </>
        )
      }
      view={
        state.isNeedsAttention ? undefined : (
          <SegmentedControl
            label="Bookings view"
            activeId={url.view}
            onChange={(id) => url.setView(id === "list" ? "list" : "calendar")}
            items={VIEW_ITEMS}
          />
        )
      }
    />
  );
}
