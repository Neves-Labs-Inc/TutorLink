// One upcoming Booking in the Bookings tab's divided card.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { BookingStatusBadge, KindBadge } from "@/components/kit/components/badges";
import type { BookingSummary } from "@/lib/queries/bookings";
import { formatBookingWhat, formatBookingWhen } from "@/pages/staff/lib/staff-bookings";

type StaffBookingRowProps = {
  booking: BookingSummary;
  onOpen: (id: string) => void;
};

export default function StaffBookingRow({
  booking,
  onOpen,
}: StaffBookingRowProps): ReactNode {
  const when = formatBookingWhen(booking);
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(booking.id)}
        className="group flex min-h-[72px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-(--tl-tint) focus-visible:-outline-offset-2! active:bg-(--tl-tint-strong)"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-6 font-semibold tabular-nums">
            {/* Breaks only at the dot, so the time range never splits. */}
            <span className="whitespace-nowrap">{when.day} ·</span>{" "}
            <span className="whitespace-nowrap">{when.range}</span>
          </span>
          <span className="block truncate text-[13px] leading-[18px] text-(--tl-muted)">
            {formatBookingWhat(booking)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <BookingStatusBadge status={booking.status} />
          {booking.kind === "evaluation" && <KindBadge kind={booking.kind} />}
        </span>
        <ChevronRight
          aria-hidden
          className="size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0"
        />
      </button>
    </li>
  );
}
