// The List view's body: loading, error, the empty week, or the week's
// Bookings by day with the Pager under them when the week runs long.
import type { ReactNode } from "react";
import { CalendarSearch, CalendarX2 } from "lucide-react";
import { Pager } from "@/components/kit/components/pager";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/kit/states/states";
import WeekList from "@/pages/bookings/components/week-list";
import { WEEK_LIST_PAGE_SIZE } from "@/pages/bookings/hooks/use-week-list";
import type { WeekListState } from "@/pages/bookings/hooks/use-week-list";
import { formatWeekRange } from "@/pages/bookings/lib/labels";

const LIST_COLUMNS = 6;
const SKELETON_ROWS = 6;

type WeekContentProps = {
  list: WeekListState;
  weekStart: string;
  today: string;
  page: number;
  isFiltered: boolean;
  onOpenBooking: (id: string) => void;
  onPageChange: (page: number) => void;
};

export default function WeekContent({
  list,
  weekStart,
  today,
  page,
  isFiltered,
  onOpenBooking,
  onPageChange,
}: WeekContentProps): ReactNode {
  if (list.status === "loading") {
    return (
      <TableSkeleton
        rows={SKELETON_ROWS}
        columns={LIST_COLUMNS}
        label="Loading bookings"
      />
    );
  }
  if (list.status === "error") {
    return (
      <ErrorState
        title="Couldn’t load bookings"
        body="Check your connection and try again."
        onRetry={list.retry}
        isRetrying={list.isRetrying}
      />
    );
  }
  if (list.bookings.length === 0 && page === 1) {
    return isFiltered ? (
      <EmptyState
        icon={CalendarSearch}
        title="No bookings match"
        body="Try another name, or clear the filters to see the whole week."
      />
    ) : (
      <EmptyState
        icon={CalendarX2}
        title="No bookings this week"
        body={`Nothing is booked from ${formatWeekRange(weekStart, " to ")}.`}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <WeekList
        bookings={list.bookings}
        today={today}
        onOpenBooking={onOpenBooking}
      />
      <Pager
        page={page}
        pageSize={WEEK_LIST_PAGE_SIZE}
        total={list.total}
        onPageChange={onPageChange}
        label="Bookings pages"
        isDisabled={list.isPaging}
      />
    </div>
  );
}
