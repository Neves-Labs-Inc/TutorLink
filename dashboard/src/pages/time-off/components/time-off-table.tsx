// One Admin queue tab in the kit's DataTable: Who · When · Reason · In
// these dates · Asked (Pending) or Status (the rest). Reason is wide-only:
// at a 1280 window the table is under 1024px. Whole rows open the
// details; no row actions.
import type { ReactNode } from "react";
import { CalendarX2 } from "lucide-react";
import { Avatar, TimeOffBadge } from "@/components/kit/components/badges";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column, PhoneRow } from "@/components/kit/components/data-table";
import { pluralize } from "@/components/kit/format";
import type { ExceptionRead } from "@/lib/queries/time-off";
import { roleLabel } from "@/lib/users/users";
import {
  formatStamp,
  formatTimeOffDates,
  formatTimeOffLength,
} from "@/pages/time-off/lib/time-off-copy";
import { getTimeOffBadgeStatus } from "@/pages/time-off/lib/time-off-rules";
import type { QueueTab } from "@/pages/time-off/lib/time-off-rules";

// Clashes only count while the Time off can still take effect.
function hasLiveClashes(item: ExceptionRead): boolean {
  return item.status === "pending" || item.status === "approved";
}

function formatBookings(count: number): string {
  return pluralize(count, "Booking", "Bookings");
}

function ClashCell({ item }: { item: ExceptionRead }): ReactNode {
  const count = item.clashing_bookings_count;
  let cell: ReactNode = "—";
  if (hasLiveClashes(item) && count > 0) {
    cell = (
      <span className="inline-flex items-center gap-1.5 text-[14px] font-medium text-(--tl-warning)">
        <CalendarX2 aria-hidden className="size-4 shrink-0" />
        {formatBookings(count)}
      </span>
    );
  } else if (hasLiveClashes(item)) {
    cell = <span className="text-(--tl-ink-soft)">None</span>;
  }
  return cell;
}

function getStatusBadge(item: ExceptionRead): ReactNode {
  return <TimeOffBadge status={getTimeOffBadgeStatus(item.status)} />;
}

function getColumns(tab: QueueTab): Column<ExceptionRead>[] {
  const lastColumn: Column<ExceptionRead> =
    tab === "pending"
      ? {
          id: "asked",
          header: "Asked",
          width: "16%",
          render: (item) => (
            <span className="tabular-nums">{formatStamp(item.created_at)}</span>
          ),
        }
      : { id: "status", header: "Status", width: "16%", render: getStatusBadge };
  return [
    {
      id: "who",
      header: "Who",
      width: "30%",
      render: (item) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={item.staff.name} />
          {/* Contained like Reason, so a long name truncates instead of
              widening the column. */}
          <span className="min-w-0 flex-1 [contain:inline-size]">
            <span className="block truncate text-[15px] font-semibold">
              {item.staff.name}
            </span>
            <span className="block text-[13px] text-(--tl-muted)">
              {roleLabel(item.staff.role)}
            </span>
          </span>
        </span>
      ),
    },
    {
      id: "when",
      header: "When",
      width: "24%",
      render: (item) => (
        <span className="block">
          <span className="block text-[15px] tabular-nums">
            {formatTimeOffDates(item)}
          </span>
          <span className="block text-[13px] text-(--tl-muted)">
            {formatTimeOffLength(item)}
          </span>
        </span>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      isWideOnly: true,
      // An auto-width cell grows to fit its text; contain keeps the reason
      // out of that, so it truncates to the room the column gets, with a
      // floor that keeps a short reason whole.
      render: (item) => (
        <span className="block min-w-40 truncate [contain:inline-size]">
          {item.reason ?? <span className="text-(--tl-muted)">None given</span>}
        </span>
      ),
    },
    {
      id: "clashes",
      header: "In these dates",
      width: "16%",
      render: (item) => <ClashCell item={item} />,
    },
    lastColumn,
  ];
}

// Meta: the clash count, else the reason, else the length.
function getMeta(item: ExceptionRead): string {
  const count = item.clashing_bookings_count;
  return hasLiveClashes(item) && count > 0
    ? `${formatBookings(count)} in these dates`
    : (item.reason ?? formatTimeOffLength(item));
}

type TimeOffTableProps = {
  tab: QueueTab;
  tabLabel: string;
  rows: ExceptionRead[];
  onOpen: (item: ExceptionRead) => void;
};

export default function TimeOffTable({
  tab,
  tabLabel,
  rows,
  onOpen,
}: TimeOffTableProps): ReactNode {
  const getPhoneRow = (item: ExceptionRead): PhoneRow => ({
    leading: <Avatar name={item.staff.name} />,
    title: item.staff.name,
    subtitle: formatTimeOffDates(item),
    meta: getMeta(item),
    trailing: tab === "pending" ? undefined : getStatusBadge(item),
  });
  return (
    <DataTable
      caption={`Time off, ${tabLabel}`}
      rows={rows}
      columns={getColumns(tab)}
      getRowId={(item) => item.id}
      getRowTitle={(item) => `${item.staff.name}, ${formatTimeOffDates(item)}`}
      getPhoneRow={getPhoneRow}
      isRowMuted={(item) => item.status === "cancelled" || item.status === "expired"}
      onOpenRow={onOpen}
    />
  );
}
