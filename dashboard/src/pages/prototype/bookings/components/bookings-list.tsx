// List view: the week's Bookings grouped by day in the kit's DataTable
// (a table on desktop, rows on phone). In the current week, days before
// today fold into "Earlier this week" so the list opens on what's next.
import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { DataTable } from "@/pages/prototype/shell-kit/kit/components/data-table";
import type { Column } from "@/pages/prototype/shell-kit/kit/components/data-table";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import BookingBadges from "@/pages/prototype/bookings/components/booking-badges";
import { REASON_ICON } from "@/pages/prototype/bookings/lib/reason-icons";
import {
  REASON_LABEL,
  formatHome,
  getSubjectLine,
  formatShortDay,
  formatTime,
  getDurationMinutes,
  getRelativeDay,
  KIND_LABEL,
  pluralize,
  STATUS_LABEL,
} from "@/pages/prototype/bookings/lib/format";
import { TODAY } from "@/pages/prototype/bookings/lib/mock-data";
import type { BookingSummary } from "@/pages/prototype/bookings/lib/wire";

const COLUMNS: Column<BookingSummary>[] = [
  {
    id: "time",
    header: "Time",
    width: "150px",
    render: (booking) => (
      <span className="flex flex-col tabular-nums">
        <span className="text-[15px] font-semibold">{formatTime(booking.start_time)}</span>
        <span className="text-[13px] text-(--tl-muted)">
          {getDurationMinutes(booking.start_time, booking.end_time)} min
        </span>
      </span>
    ),
  },
  {
    id: "child",
    header: "Child",
    render: (booking) => (
      <span className="flex min-w-0 flex-col">
        <span
          className={cn(
            "truncate text-[15px] font-semibold",
            booking.status === "cancelled" && "line-through decoration-(--tl-muted)",
          )}
        >
          {booking.child.name}
        </span>
        <span className="truncate text-[13px] text-(--tl-muted)">
          {getSubjectLine(booking)}
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
    render: (booking) => (
      <span className="line-clamp-2 text-(--tl-ink-soft)">{formatHome(booking.home)}</span>
    ),
  },
  {
    id: "badges",
    header: "",
    width: "220px",
    render: (booking) => (
      <span className="flex flex-wrap justify-end gap-1.5">
        <BookingBadges booking={booking} />
      </span>
    ),
  },
];

function getPhoneTrailing(booking: BookingSummary): ReactNode {
  const [reason] = booking.sort_out_reasons;
  // Icon only on phones, so the Child's name keeps the room.
  if (reason) {
    const Icon = REASON_ICON[reason];
    return (
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-(--tl-warning-tint) text-(--tl-warning)">
        <Icon aria-hidden className="size-4" />
        <span className="sr-only">{REASON_LABEL[reason]}</span>
      </span>
    );
  }
  if (booking.status === "cancelled" || booking.status === "completed") {
    return (
      <span className="shrink-0 text-[13px] font-medium text-(--tl-muted)">
        {STATUS_LABEL[booking.status]}
      </span>
    );
  }
  return null;
}

type DayTableProps = {
  rows: BookingSummary[];
  onOpen: (booking: BookingSummary) => void;
};

export function DayTable({ rows, onOpen }: DayTableProps): ReactNode {
  return (
    <DataTable
      caption="Bookings"
      rows={rows}
      columns={COLUMNS}
      getRowId={(booking) => booking.id}
      getRowTitle={(booking) => `${booking.child.name}, ${formatTime(booking.start_time)}`}
      isRowMuted={(booking) => booking.status === "cancelled"}
      onOpenRow={onOpen}
      getPhoneRow={(booking) => ({
        leading: (
          <span
            className={cn(
              "flex w-[68px] shrink-0 flex-col items-center rounded-[14px] py-1.5 text-[13px] leading-4 font-semibold tabular-nums",
              booking.kind === "evaluation"
                ? "bg-(--tl-pink-tint) text-(--tl-pink-ink)"
                : "bg-(--tl-tint) text-(--tl-primary-ink)",
            )}
          >
            {formatTime(booking.start_time).replace(" ", " ")}
          </span>
        ),
        title: booking.child.name,
        subtitle: `${booking.kind === "evaluation" ? KIND_LABEL.evaluation : (booking.subject?.name ?? "")} · ${booking.staff.name}`,
        meta: `${getDurationMinutes(booking.start_time, booking.end_time)} min · ${booking.home ? "Home" : "In office"}`,
        trailing: getPhoneTrailing(booking),
      })}
    />
  );
}

type DayGroup = { day: string; rows: BookingSummary[] };

function groupByDay(rows: BookingSummary[]): DayGroup[] {
  const days = [...new Set(rows.map((row) => row.scheduled_date))].sort();
  return days.map((day) => ({
    day,
    rows: rows.filter((row) => row.scheduled_date === day),
  }));
}

type DaySectionProps = DayTableProps & { group: DayGroup };

function DaySection({ group, rows, onOpen }: DaySectionProps): ReactNode {
  const headingId = `day-${group.day}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="flex items-baseline gap-3 px-1 pb-3">
        <span className="kit-display text-[18px] font-bold">{getRelativeDay(group.day)}</span>
        <span className="text-[14px] text-(--tl-muted)">
          {formatShortDay(group.day)} · {pluralize(rows.length, "booking", "bookings")}
        </span>
      </h2>
      <DayTable rows={rows} onOpen={onOpen} />
    </section>
  );
}

type BookingsListProps = {
  rows: BookingSummary[];
  onOpen: (booking: BookingSummary) => void;
  // Off for Needs attention, where the past days are the point.
  foldsEarlier?: boolean;
};

export default function BookingsList({
  rows,
  onOpen,
  foldsEarlier = true,
}: BookingsListProps): ReactNode {
  const [isEarlierOpen, setIsEarlierOpen] = useState(false);
  const groups = groupByDay(rows);
  const earlier = groups.filter((group) => group.day < TODAY);
  const ahead = groups.filter((group) => group.day >= TODAY);
  // A past week has no "ahead": show it all, oldest first.
  const isPastWeek = ahead.length === 0;
  if (!foldsEarlier) {
    return (
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <DaySection key={group.day} group={group} rows={group.rows} onOpen={onOpen} />
        ))}
      </div>
    );
  }
  const earlierCount = earlier.reduce((total, group) => total + group.rows.length, 0);

  return (
    <div className="flex flex-col gap-8">
      {!isPastWeek && earlier.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={isEarlierOpen}
            onClick={() => setIsEarlierOpen(!isEarlierOpen)}
            className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full px-3 text-[14px] font-semibold text-(--tl-link) hover:bg-(--tl-tint)"
          >
            <ChevronDown
              aria-hidden
              className={cn("size-4 transition-transform duration-150", isEarlierOpen && "rotate-180")}
            />
            {isEarlierOpen ? "Hide" : "Show"} earlier this week ·{" "}
            {pluralize(earlierCount, "booking", "bookings")}
          </button>
          {isEarlierOpen && (
            <div className="mt-4 flex flex-col gap-8">
              {earlier.map((group) => (
                <DaySection key={group.day} group={group} rows={group.rows} onOpen={onOpen} />
              ))}
            </div>
          )}
        </div>
      )}
      {(isPastWeek ? earlier : ahead).map((group) => (
        <DaySection key={group.day} group={group} rows={group.rows} onOpen={onOpen} />
      ))}
    </div>
  );
}
