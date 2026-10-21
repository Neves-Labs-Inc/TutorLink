// The phone calendar: a 7-day strip over the chosen day's Bookings as
// rows. Phones have no empty-hour tap; the page's New booking covers it.
import type { ReactNode } from "react";
import { Building2, CalendarX2, MapPin, Plane } from "lucide-react";
import {
  BookingReasonBadge,
  BookingStatusBadge,
} from "@/components/kit/components/badges";
import { ListRow, TimeBlock } from "@/components/kit/components/list-row";
import type { RowDetail } from "@/components/kit/components/list-row";
import { formatDay } from "@/components/kit/format";
import { CARD_TITLE } from "@/components/kit/tokens";
import DayStrip from "@/components/bookings-calendar/day-strip";
import { getBookingsOn, getTimeOffOn, getWhat } from "@/lib/bookings/calendar";
import { formatTime } from "@/lib/dates/dates";
import type { BookingSummary } from "@/lib/queries/bookings";
import type { OfficeTimeOff } from "@/lib/queries/exceptions";

function getLocation(booking: BookingSummary): RowDetail {
  if (!booking.home) return { icon: Building2, text: "In office" };
  return { icon: MapPin, text: booking.home.label ?? booking.home.address };
}

type AgendaRowProps = { booking: BookingSummary; onOpen: () => void };

function AgendaRow({ booking, onOpen }: AgendaRowProps): ReactNode {
  const isCancelled = booking.status === "cancelled";
  const reasons = isCancelled ? [] : booking.sort_out_reasons;
  return (
    <ListRow
      leading={
        <TimeBlock
          time={formatTime(booking.start_time)}
          caption={`to ${formatTime(booking.end_time)}`}
          tone={booking.kind === "evaluation" ? "pink" : "primary"}
        />
      }
      title={booking.child.name}
      subtitle={`${getWhat(booking)} · ${booking.staff.name}`}
      details={[getLocation(booking)]}
      badges={
        reasons.length > 0 || booking.status !== "confirmed" ? (
          <>
            {reasons.map((reason) => (
              <BookingReasonBadge key={reason} reason={reason} />
            ))}
            {booking.status !== "confirmed" && (
              <BookingStatusBadge status={booking.status} />
            )}
          </>
        ) : undefined
      }
      isMuted={isCancelled}
      isStruck={isCancelled}
      onOpen={onOpen}
    />
  );
}

type DayAgendaProps = {
  weekStart: string;
  day: string;
  today: string;
  bookings: BookingSummary[];
  timeOff: OfficeTimeOff[];
  userIds: string[];
  onDayChange: (day: string) => void;
  onOpenBooking: (id: string) => void;
};

export default function DayAgenda({
  weekStart,
  day,
  today,
  bookings,
  timeOff,
  userIds,
  onDayChange,
  onOpenBooking,
}: DayAgendaProps): ReactNode {
  const dayBookings = getBookingsOn(bookings, day);
  return (
    <div className="flex flex-col gap-4">
      <DayStrip
        weekStart={weekStart}
        day={day}
        today={today}
        bookings={bookings}
        onDayChange={onDayChange}
      />
      <h2 aria-live="polite" className={CARD_TITLE}>
        {formatDay(day, { weekday: "long", month: "long", day: "numeric" })}
      </h2>
      {getTimeOffOn(timeOff, day, userIds).map((off) => (
        <p
          key={off.id}
          className="flex items-center gap-2 rounded-full bg-(--tl-yellow-tint) px-4 py-2 text-[13px] font-semibold text-(--tl-yellow-ink)"
        >
          <Plane aria-hidden className="size-4 shrink-0" />
          {off.staff.name} is off (approved Time off)
        </p>
      ))}
      {dayBookings.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {dayBookings.map((booking) => (
            <li key={booking.id}>
              <AgendaRow booking={booking} onOpen={() => onOpenBooking(booking.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-4 text-[14px]">
          <CalendarX2 aria-hidden className="size-4 shrink-0 text-(--tl-muted)" />
          Nothing booked on {formatDay(day, { weekday: "long" })}.
        </p>
      )}
    </div>
  );
}
