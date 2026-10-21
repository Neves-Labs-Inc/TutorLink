// Needs attention: To do's Bookings list as one table. A Booking opens
// its details, a Child needing a Tutor opens their family, and a Child
// awaiting an Evaluation opens New booking for it.
import type { ReactNode } from "react";
import { Avatar, BookingReasonBadge } from "@/components/kit/components/badges";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column, PhoneRow } from "@/components/kit/components/data-table";
import { formatClock } from "@/components/kit/format";
import type { BookingTodoItem } from "@/lib/bookings/booking-todo";
import ReasonDisc from "@/pages/bookings/components/reason-disc";
import TodoChip from "@/pages/bookings/components/todo-chip";
import {
  formatLevels,
  formatShortDate,
  formatWaiting,
  getSubjectLabel,
} from "@/pages/bookings/lib/labels";

const NO_GUARDIAN = "No Guardian";
const SECOND_LINE = "block truncate text-[13px] text-(--tl-muted)";

function getRowId(item: BookingTodoItem): string {
  return item.kind === "booking"
    ? `booking-${item.booking.id}`
    : `${item.kind}-${item.child.id}`;
}

function getChildName(item: BookingTodoItem): string {
  return item.kind === "booking" ? item.booking.child.name : item.child.name;
}

function getChildLine(item: BookingTodoItem): string {
  let line = item.kind === "booking" ? getSubjectLabel(item.booking) : "";
  if (item.kind === "needs-tutor") {
    line = formatLevels(item.child);
  } else if (item.kind === "evaluation") {
    line = item.child.guardians[0]?.name ?? NO_GUARDIAN;
  }
  return line;
}

function Reasons({ item }: { item: BookingTodoItem }): ReactNode {
  let reasons: ReactNode;
  if (item.kind === "booking") {
    reasons = item.booking.sort_out_reasons.map((reason) => (
      <BookingReasonBadge key={reason} reason={reason} />
    ));
  } else {
    reasons = (
      <BookingReasonBadge
        reason={
          item.kind === "needs-tutor" ? "needs_tutor" : "evaluation_to_book"
        }
      />
    );
  }
  return <span className="flex flex-wrap gap-1.5">{reasons}</span>;
}

type NeedsAttentionListProps = {
  items: BookingTodoItem[];
  now: Date;
  onOpen: (item: BookingTodoItem) => void;
};

export default function NeedsAttentionList({
  items,
  now,
  onOpen,
}: NeedsAttentionListProps): ReactNode {
  function getWhen(item: BookingTodoItem): string {
    let when = "—";
    if (item.kind === "booking") {
      when = `${formatShortDate(item.booking.scheduled_date)}, ${formatClock(item.booking.start_time)}`;
    } else if (item.kind === "evaluation") {
      when = formatWaiting(item.child, now);
    }
    return when;
  }

  // Names what the row opens.
  function getRowTitle(item: BookingTodoItem): string {
    const name = getChildName(item);
    let title = `${name}, ${getWhen(item)}`;
    if (item.kind === "needs-tutor") {
      title = `${name} · Needs a Tutor`;
    } else if (item.kind === "evaluation") {
      title = `${name} · ${getWhen(item)}`;
    }
    return title;
  }

  function getPhoneRow(item: BookingTodoItem): PhoneRow {
    let row: PhoneRow = {
      leading: <TodoChip item={item} />,
      title: getChildName(item),
      subtitle: "Evaluation to book",
      meta: `${getWhen(item)} · ${getChildLine(item)}`,
    };
    if (item.kind === "booking") {
      row = {
        ...row,
        subtitle: `${getWhen(item)} · ${item.booking.staff.name}`,
        meta: undefined,
        trailing: item.booking.sort_out_reasons[0] && (
          <ReasonDisc reason={item.booking.sort_out_reasons[0]} />
        ),
      };
    } else if (item.kind === "needs-tutor") {
      row = {
        ...row,
        subtitle: "Needs a Tutor",
        meta: getChildLine(item) || undefined,
      };
    }
    return row;
  }

  const columns: Column<BookingTodoItem>[] = [
    {
      id: "when",
      header: "When",
      width: "170px",
      render: (item) => (
        <span className="whitespace-nowrap tabular-nums">{getWhen(item)}</span>
      ),
    },
    {
      id: "child",
      header: "Child",
      render: (item) => (
        // contain: a long name truncates instead of widening the table.
        <span className="block min-w-0 [contain:inline-size]">
          <span className="block truncate text-[15px] font-semibold">
            {getChildName(item)}
          </span>
          <span className={SECOND_LINE}>{getChildLine(item)}</span>
        </span>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      render: (item) => <Reasons item={item} />,
    },
    {
      id: "staff",
      header: "Staff",
      render: (item) =>
        item.kind === "booking" ? (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={item.booking.staff.name} size="sm" />
            <span className="min-w-0 flex-1 truncate [contain:inline-size]">
              {item.booking.staff.name}
            </span>
          </span>
        ) : (
          <span className="text-(--tl-muted)">—</span>
        ),
    },
  ];

  return (
    <DataTable
      caption="Bookings that need attention"
      rows={items}
      columns={columns}
      getRowId={getRowId}
      getRowTitle={getRowTitle}
      getPhoneRow={getPhoneRow}
      onOpenRow={onOpen}
    />
  );
}
