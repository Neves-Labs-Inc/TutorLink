// A long detail that shows DetailOverlay's pinned header: the week's
// Bookings, with the heading and close X kept in view while the list
// scrolls under them.
import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import {
  formatDay,
  formatTimeRange,
  getDayKey,
} from "@/pages/prototype/shell-kit/kit/format";
import { BOOKINGS } from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  BookingStatusBadge,
  KindBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import type { PhoneDetailMode } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";

type WeekDetailProps = {
  isOpen: boolean;
  onClose: () => void;
  phoneMode: PhoneDetailMode;
};

export default function WeekDetail({
  isOpen,
  onClose,
  phoneMode,
}: WeekDetailProps): ReactNode {
  return (
    <DetailOverlay
      isOpen={isOpen}
      onClose={onClose}
      title="This week’s Bookings"
      backLabel="Overlays"
      phoneMode={phoneMode}
      isHeaderPinned
      header={
        <div>
          <h2 className="kit-display text-[24px] leading-8 font-light">
            This week’s Bookings
          </h2>
          <p className="text-[14px] text-(--tl-muted)">
            {BOOKINGS.length} Bookings, Oct 12 to 16
          </p>
        </div>
      }
    >
      <ul className="mt-4 flex flex-col gap-5">
        {BOOKINGS.map((booking) => (
          <li key={booking.id}>
            <DetailRow
              icon={CalendarDays}
              label={formatDay(getDayKey(booking.start), {
                weekday: "long",
                month: "short",
                day: "numeric",
              })}
            >
              <p className="font-semibold">{booking.child}</p>
              <p className="text-(--tl-ink-soft) tabular-nums">
                {formatTimeRange(booking)} · {booking.subject}
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                <KindBadge kind={booking.kind} />
                <BookingStatusBadge status={booking.status} />
              </div>
            </DetailRow>
          </li>
        ))}
      </ul>
    </DetailOverlay>
  );
}
