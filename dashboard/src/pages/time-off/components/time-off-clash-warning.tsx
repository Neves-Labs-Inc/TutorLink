// The API's clash warning on an Admin's entry, shown in place in the
// sheet until it's confirmed with Add anyway or the window changes.
import type { ReactNode, Ref } from "react";
import { CalendarX2 } from "lucide-react";
import { pluralize } from "@/components/kit/format";
import type { TimeOffWarning } from "@/lib/queries/time-off";
import { formatBookingStart } from "@/pages/time-off/lib/time-off-copy";

type TimeOffClashWarningProps = {
  warnings: TimeOffWarning[];
  wellRef: Ref<HTMLDivElement>;
};

export default function TimeOffClashWarning({
  warnings,
  wellRef,
}: TimeOffClashWarningProps): ReactNode {
  const bookings = warnings.flatMap((warning) => warning.clashing_bookings);
  return (
    <div
      ref={wellRef}
      role="alert"
      className="kit-rise rounded-[16px] bg-(--tl-warning-tint) p-4 text-(--tl-warning)"
    >
      <p className="flex items-center gap-2 text-[15px] leading-[22px] font-semibold">
        <CalendarX2 aria-hidden className="size-[18px] shrink-0" />
        This time off clashes with{" "}
        {pluralize(bookings.length, "Booking", "Bookings")}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5 text-[14px] leading-5 text-(--tl-ink)">
        {bookings.map((booking) => (
          <li key={booking.booking_id} className="tabular-nums">
            <span className="font-semibold">{booking.child_name}</span>
            {" · "}
            {formatBookingStart(booking.date, booking.start_time)}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] leading-[18px]">
        Adding it keeps those Bookings and puts them in To do to change or
        keep.
      </p>
    </div>
  );
}
