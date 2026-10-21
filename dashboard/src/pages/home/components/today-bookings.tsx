// Admins' Today's bookings: every Booking today but cancelled ones, as a
// table that folds into rows on phones. The next one comes first; the
// ones already over sit at the bottom, muted. Each row opens its details.
import type { ReactNode } from "react";
import { CalendarCheck } from "lucide-react";
import { Avatar, KindBadge } from "@/components/kit/components/badges";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column } from "@/components/kit/components/data-table";
import { TimeBlock } from "@/components/kit/components/list-row";
import { formatClock, formatDay } from "@/components/kit/format";
import {
  EmptyState,
  InlineError,
  TableSkeleton,
} from "@/components/kit/states/states";
import type { BookingSummary } from "@/lib/queries/bookings";
import type { HomeGroup } from "@/pages/home/hooks/use-home-data";
import {
  getLocationLabel,
  getSubjectLabel,
  getTodayTiming,
} from "@/pages/home/lib/home-labels";

const HAPPENING_NOW = "Happening now";

type TodayBookingsProps = {
  group: HomeGroup<BookingSummary[]>;
  today: string;
  now: Date;
  onOpen: (bookingId: string) => void;
};

export default function TodayBookings({
  group,
  today,
  now,
  onOpen,
}: TodayBookingsProps): ReactNode {
  if (group.phase === "loading") {
    return (
      <TableSkeleton rows={4} columns={5} label="Loading today’s bookings" />
    );
  }
  if (group.phase === "error" || !group.data) {
    return (
      <InlineError
        message="Couldn’t load today’s bookings. Check your connection and try again."
        onRetry={group.retry}
        isRetrying={group.isRetrying}
      />
    );
  }
  if (group.data.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No bookings today"
        body={`Nothing is booked for ${formatDay(today, { weekday: "long", month: "long", day: "numeric" })}.`}
      />
    );
  }

  const columns: Column<BookingSummary>[] = [
    {
      id: "time",
      header: "Time",
      width: "180px",
      render: (booking) => (
        <>
          <span className="block text-[15px] leading-6 font-semibold tabular-nums">
            {formatClock(booking.start_time)}
          </span>
          {getTodayTiming(booking, now) === "now" ? (
            <span className="block text-[13px] leading-[18px] font-semibold text-(--tl-success)">
              {HAPPENING_NOW}
            </span>
          ) : (
            <span className="block text-[13px] leading-[18px] text-(--tl-muted) tabular-nums">
              until {formatClock(booking.end_time)}
            </span>
          )}
        </>
      ),
    },
    {
      id: "child",
      header: "Child",
      render: (booking) => (
        <>
          <span className="block font-semibold">{booking.child.name}</span>
          <span className="block text-[13px] text-(--tl-muted)">
            {getSubjectLabel(booking)}
          </span>
        </>
      ),
    },
    {
      id: "staff",
      header: "Staff",
      render: (booking) => (
        <span className="flex items-center gap-2">
          <Avatar name={booking.staff.name} size="sm" />
          {booking.staff.name}
        </span>
      ),
    },
    {
      id: "location",
      header: "Location",
      isWideOnly: true,
      render: getLocationLabel,
    },
    {
      id: "kind",
      header: "Kind",
      width: "150px",
      render: (booking) => <KindBadge kind={booking.kind} />,
    },
  ];

  return (
    <DataTable
      caption="Today’s bookings"
      rows={group.data}
      columns={columns}
      getRowId={(booking) => booking.id}
      getRowTitle={(booking) =>
        `${booking.child.name} at ${formatClock(booking.start_time)}`
      }
      getPhoneRow={(booking) => {
        const isNow = getTodayTiming(booking, now) === "now";
        return {
          leading: (
            <TimeBlock
              time={formatClock(booking.start_time)}
              caption={`to ${formatClock(booking.end_time)}`}
              tone={booking.kind === "evaluation" ? "pink" : "primary"}
            />
          ),
          title: booking.child.name,
          subtitle: `${getSubjectLabel(booking)} · ${booking.staff.name}`,
          meta: isNow
            ? `${HAPPENING_NOW} · ${getLocationLabel(booking)}`
            : getLocationLabel(booking),
        };
      }}
      onOpenRow={(booking) => onOpen(booking.id)}
      isRowMuted={(booking) => getTodayTiming(booking, now) === "past"}
    />
  );
}
