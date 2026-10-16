// Admin Home, below To do: today's Bookings as the kit table (rows on
// phone). Next one first, those already over at the bottom, dimmed;
// Evaluations carry the pink accent. The row only opens the Booking:
// no actions here (TutorLink#189).
import type { ReactNode } from "react";
import { CalendarCheck } from "lucide-react";
import { Avatar, KindBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { DataTable } from "@/pages/prototype/shell-kit/kit/components/data-table";
import type { Column } from "@/pages/prototype/shell-kit/kit/components/data-table";
import { EmptyState, ErrorState, TableSkeleton } from "@/pages/prototype/shell-kit/kit/states/states";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import type { Phase } from "@/pages/prototype/home/hooks/use-home-data";
import {
  formatClock,
  getLocationLabel,
  getSubjectLabel,
  isHappeningNow,
  isPast,
  sortForToday,
} from "@/pages/prototype/home/lib/labels";
import type { BookingSummary } from "@/pages/prototype/home/types/api";

const SKELETON_COLUMNS = 5;

function getKindLabel(booking: BookingSummary): "Tutoring" | "Evaluation" {
  return booking.kind === "evaluation" ? "Evaluation" : "Tutoring";
}

const COLUMNS: Column<BookingSummary>[] = [
  {
    id: "time",
    header: "Time",
    width: "180px",
    render: (booking) => <TimeCell booking={booking} />,
  },
  {
    id: "child",
    header: "Child",
    render: (booking) => (
      <span className="block min-w-0">
        <span className="block truncate text-[15px] font-semibold">
          {booking.child.name}
        </span>
        <span className="block truncate text-[13px] text-(--tl-muted)">
          {getSubjectLabel(booking)}
        </span>
      </span>
    ),
  },
  {
    id: "staff",
    header: "Staff",
    render: (booking) => (
      <span className="flex items-center gap-2">
        <Avatar name={booking.staff.name} size="sm" />
        <span className="truncate">{booking.staff.name}</span>
      </span>
    ),
  },
  {
    id: "location",
    header: "Location",
    isWideOnly: true,
    render: (booking) => <span className="truncate">{getLocationLabel(booking)}</span>,
  },
  {
    id: "kind",
    header: "Kind",
    width: "150px",
    render: (booking) => <KindBadge kind={getKindLabel(booking)} />,
  },
];

type TimeCellProps = { booking: BookingSummary };

function TimeCell({ booking }: TimeCellProps): ReactNode {
  return (
    <span className="flex flex-col tabular-nums">
      <span className="text-[15px] font-semibold">
        {formatClock(booking.start_time)}
      </span>
      <span className="text-[13px] text-(--tl-muted)">
        {isHappeningNow(booking) ? (
          <span className="font-semibold text-(--tl-success)">Happening now</span>
        ) : (
          `until ${formatClock(booking.end_time)}`
        )}
      </span>
    </span>
  );
}

type TimeChipProps = { booking: BookingSummary };

// The phone row's leading chip; pink for an Evaluation.
function TimeChip({ booking }: TimeChipProps): ReactNode {
  const [clock, meridiem] = formatClock(booking.start_time).split(" ");
  const isEvaluation = booking.kind === "evaluation";
  return (
    <span
      className={cn(
        "flex w-[64px] shrink-0 flex-col items-center rounded-[16px] py-2 tabular-nums",
        isEvaluation
          ? "bg-(--tl-pink-tint) text-(--tl-pink-ink)"
          : "bg-(--tl-tint) text-(--tl-primary-ink)",
      )}
    >
      <span className="text-[15px] leading-5 font-semibold">{clock}</span>
      <span className="text-[12px] leading-4 font-medium">{meridiem}</span>
    </span>
  );
}

type TodayBookingsProps = {
  phase: Phase;
  bookings: BookingSummary[];
  onOpen: (booking: BookingSummary) => void;
  onRetry: () => void;
};

export default function TodayBookings({
  phase,
  bookings,
  onOpen,
  onRetry,
}: TodayBookingsProps): ReactNode {
  let content: ReactNode = (
    <DataTable
      caption="Today’s bookings"
      rows={sortForToday(bookings)}
      columns={COLUMNS}
      getRowId={(booking) => booking.id}
      getRowTitle={(booking) =>
        `${booking.child.name} at ${formatClock(booking.start_time)}`
      }
      getPhoneRow={(booking) => ({
        leading: <TimeChip booking={booking} />,
        title: booking.child.name,
        subtitle: `${getSubjectLabel(booking)} · ${booking.staff.name}`,
        meta: isHappeningNow(booking)
          ? `Happening now · ${getLocationLabel(booking)}`
          : getLocationLabel(booking),
      })}
      onOpenRow={onOpen}
      isRowMuted={isPast}
    />
  );
  if (phase === "loading") {
    content = <TableSkeleton rows={4} columns={SKELETON_COLUMNS} label="Loading today’s bookings" />;
  } else if (phase === "error") {
    content = (
      <ErrorState
        title="Couldn’t load today’s bookings"
        body="Check your connection and try again."
        onRetry={onRetry}
      />
    );
  } else if (bookings.length === 0) {
    content = (
      <EmptyState
        icon={CalendarCheck}
        title="No bookings today"
        body="Nothing is booked for today. Upcoming days are on Bookings."
      />
    );
  }
  return content;
}
