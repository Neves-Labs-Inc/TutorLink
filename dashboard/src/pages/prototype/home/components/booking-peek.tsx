// What a today row opens. The real Booking details belong to the
// Bookings prototype; this shows only the BookingSummary fields Home
// already has, so the tap has somewhere to land.
import type { ReactNode } from "react";
import { BookOpen, CalendarDays, MapPin, UserRound } from "lucide-react";
import { KindBadge } from "@/components/kit/components/badges";
import { DetailRow } from "@/components/kit/components/detail";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import PrototypeNote from "@/pages/prototype/home/components/prototype-note";
import {
  formatClock,
  formatDate,
  getSubjectLabel,
} from "@/pages/prototype/home/lib/labels";
import type { BookingSummary } from "@/pages/prototype/home/types/api";

type BookingPeekProps = {
  booking: BookingSummary | null;
  isOwnSession: boolean;
  onClose: () => void;
};

export default function BookingPeek({
  booking,
  isOwnSession,
  onClose,
}: BookingPeekProps): ReactNode {
  const noun = isOwnSession ? "Session" : "Booking";
  return (
    <DetailOverlay
      isOpen={booking !== null}
      onClose={onClose}
      title={booking ? `${noun} with ${booking.child.name}` : noun}
      backLabel="Home"
      phoneMode="page"
      header={
        booking && (
          <div className="flex flex-col gap-2">
            <KindBadge kind={booking.kind === "evaluation" ? "Evaluation" : "Tutoring"} />
            <h2 className="kit-display text-[22px] leading-[30px] font-bold">
              {booking.child.name}
            </h2>
          </div>
        )
      }
    >
      {booking && (
        <div className="flex flex-col gap-5 pt-3">
          <DetailRow icon={CalendarDays} label="When">
            {formatDate(booking.scheduled_date, { weekday: "long", month: "long", day: "numeric" })}
            , {formatClock(booking.start_time)} – {formatClock(booking.end_time)}
          </DetailRow>
          <DetailRow icon={BookOpen} label="Subject">
            {getSubjectLabel(booking)}
          </DetailRow>
          <DetailRow icon={UserRound} label="Staff">
            {booking.staff.name}
          </DetailRow>
          <DetailRow icon={MapPin} label="Location">
            {booking.home?.address ?? "In office"}
          </DetailRow>
          <PrototypeNote>
            Full {noun} details are designed in the Bookings prototype.
          </PrototypeNote>
        </div>
      )}
    </DetailOverlay>
  );
}
