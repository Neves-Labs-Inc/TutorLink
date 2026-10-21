// Needs attention's body: loading, error, all clear, or To do's whole
// Bookings list with the Pager under it when it runs long.
import type { ReactNode } from "react";
import { CircleCheckBig } from "lucide-react";
import { Pager } from "@/components/kit/components/pager";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/components/kit/states/states";
import type { BookingTodoItem } from "@/lib/bookings/booking-todo";
import NeedsAttentionList from "@/pages/bookings/components/needs-attention-list";
import { NEEDS_ATTENTION_PAGE_SIZE } from "@/pages/bookings/hooks/use-needs-attention";
import type { NeedsAttentionState } from "@/pages/bookings/hooks/use-needs-attention";

const LIST_COLUMNS = 4;
const SKELETON_ROWS = 6;

type NeedsAttentionContentProps = {
  list: NeedsAttentionState;
  now: Date;
  onOpen: (item: BookingTodoItem) => void;
  onPageChange: (page: number) => void;
};

export default function NeedsAttentionContent({
  list,
  now,
  onOpen,
  onPageChange,
}: NeedsAttentionContentProps): ReactNode {
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
  if (list.total === 0) {
    return (
      <EmptyState
        icon={CircleCheckBig}
        tone="green"
        title="Nothing needs attention"
        body="Every booking is marked, and every Child has an Evaluation and a Tutor."
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <NeedsAttentionList items={list.items} now={now} onOpen={onOpen} />
      <Pager
        page={list.page}
        pageSize={NEEDS_ATTENTION_PAGE_SIZE}
        total={list.total}
        onPageChange={onPageChange}
        label="Needs attention pages"
      />
    </div>
  );
}
