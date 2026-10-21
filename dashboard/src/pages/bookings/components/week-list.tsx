// The List view: the week's Bookings by day, each day a table that
// collapses to tappable rows on phones. Every row opens the details.
import type { ReactNode } from "react";
import {
  Avatar,
  BookingReasonBadge,
  BookingStatusBadge,
  KindBadge,
} from "@/components/kit/components/badges";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column, PhoneRow } from "@/components/kit/components/data-table";
import { TimeBlock } from "@/components/kit/components/list-row";
import {
  formatClock,
  formatDay,
  getRelativeDayLabel,
  pluralize,
} from "@/components/kit/format";
import { CARD_TITLE, cn } from "@/components/kit/tokens";
import type { BookingStatus, BookingSummary } from "@/lib/queries/bookings";
import ReasonDisc from "@/pages/bookings/components/reason-disc";
import {
  formatLength,
  getLocationLabel,
  getSubjectLabel,
} from "@/pages/bookings/lib/labels";

// Statuses a phone row names when there is no reason to show.
const PHONE_STATUS_WORD: Partial<Record<BookingStatus, string>> = {
  cancelled: "Cancelled",
  completed: "Completed",
  didnt_happen: "Didn’t happen",
};

type DayGroup = { day: string; bookings: BookingSummary[] };

function groupByDay(bookings: BookingSummary[]): DayGroup[] {
  const sorted = [...bookings].sort((a, b) =>
    `${a.scheduled_date}${a.start_time}`.localeCompare(
      `${b.scheduled_date}${b.start_time}`,
    ),
  );
  const days = [...new Set(sorted.map((booking) => booking.scheduled_date))];
  return days.map((day) => ({
    day,
    bookings: sorted.filter((booking) => booking.scheduled_date === day),
  }));
}

const isCancelled = (booking: BookingSummary): boolean =>
  booking.status === "cancelled";

const COLUMNS: Column<BookingSummary>[] = [
  {
    id: "time",
    header: "Time",
    width: "150px",
    render: (booking) => (
      <span className="block whitespace-nowrap tabular-nums">
        <span className="block text-[15px] font-semibold">
          {formatClock(booking.start_time)}
        </span>
        <span className="block text-[13px] text-(--tl-muted)">
          {formatLength(booking)}
        </span>
      </span>
    ),
  },
  {
    id: "child",
    header: "Child",
    render: (booking) => (
      // contain: a long name truncates instead of widening the table.
      <span className="block min-w-0 [contain:inline-size]">
        <span
          className={cn(
            "block truncate text-[15px] font-semibold",
            isCancelled(booking) && "line-through",
          )}
        >
          {booking.child.name}
        </span>
        <span className="block truncate text-[13px] text-(--tl-muted)">
          {getSubjectLabel(booking)}
        </span>
      </span>
    ),
  },
  {
    id: "kind",
    header: "Kind",
    width: "140px",
    render: (booking) => <KindBadge kind={booking.kind} />,
  },
  {
    id: "staff",
    header: "Staff",
    width: "200px",
    render: (booking) => (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={booking.staff.name} size="sm" />
        <span className="min-w-0 flex-1 truncate [contain:inline-size]">
          {booking.staff.name}
        </span>
      </span>
    ),
  },
  {
    id: "location",
    header: "Location",
    isWideOnly: true,
    render: (booking) => (
      <span className="line-clamp-2 text-(--tl-ink-soft)">
        {getLocationLabel(booking)}
      </span>
    ),
  },
  {
    id: "status",
    header: "Status",
    width: "220px",
    render: (booking) => (
      <span className="flex flex-wrap justify-end gap-1.5">
        {booking.sort_out_reasons.map((reason) => (
          <BookingReasonBadge key={reason} reason={reason} />
        ))}
        {booking.status !== "confirmed" && (
          <BookingStatusBadge status={booking.status} />
        )}
      </span>
    ),
  },
];

function PhoneTrailing({ booking }: { booking: BookingSummary }): ReactNode {
  const [reason] = booking.sort_out_reasons;
  const statusWord = PHONE_STATUS_WORD[booking.status];
  let trailing: ReactNode = null;
  if (reason) {
    trailing = <ReasonDisc reason={reason} />;
  } else if (statusWord) {
    trailing = (
      <span className="shrink-0 text-[13px] font-medium text-(--tl-muted)">
        {statusWord}
      </span>
    );
  }
  return trailing;
}

function getPhoneRow(booking: BookingSummary): PhoneRow {
  return {
    leading: (
      <TimeBlock
        time={formatClock(booking.start_time)}
        caption={formatLength(booking)}
        tone={booking.kind === "evaluation" ? "pink" : "primary"}
      />
    ),
    title: booking.child.name,
    isTitleStruck: isCancelled(booking),
    subtitle: `${getSubjectLabel(booking)} · ${booking.staff.name}`,
    meta: booking.location === "home" ? "Home" : "In office",
    trailing: <PhoneTrailing booking={booking} />,
  };
}

function getRowTitle(booking: BookingSummary): string {
  return `${booking.child.name}, ${formatClock(booking.start_time)}`;
}

type DaySectionProps = {
  group: DayGroup;
  today: string;
  onOpenBooking: (id: string) => void;
};

function DaySection({
  group,
  today,
  onOpenBooking,
}: DaySectionProps): ReactNode {
  const dayLabel = getRelativeDayLabel(group.day, today);
  const longDay = formatDay(group.day, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <section aria-labelledby={`day-${group.day}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 pb-3">
        <h2 id={`day-${group.day}`} className={CARD_TITLE}>
          {dayLabel}
        </h2>
        <p className="text-[14px] text-(--tl-muted)">
          {formatDay(group.day, { month: "short", day: "numeric" })} ·{" "}
          {pluralize(group.bookings.length, "booking", "bookings")}
        </p>
      </div>
      <DataTable
        caption={`Bookings on ${longDay}`}
        rows={group.bookings}
        columns={COLUMNS}
        getRowId={(booking) => booking.id}
        getRowTitle={getRowTitle}
        getPhoneRow={getPhoneRow}
        onOpenRow={(booking) => onOpenBooking(booking.id)}
        isRowMuted={isCancelled}
      />
    </section>
  );
}

type WeekListProps = {
  bookings: BookingSummary[];
  today: string;
  onOpenBooking: (id: string) => void;
};

export default function WeekList({
  bookings,
  today,
  onOpenBooking,
}: WeekListProps): ReactNode {
  return (
    <div className="flex flex-col gap-8">
      {groupByDay(bookings).map((group) => (
        <DaySection
          key={group.day}
          group={group}
          today={today}
          onOpenBooking={onOpenBooking}
        />
      ))}
    </div>
  );
}
