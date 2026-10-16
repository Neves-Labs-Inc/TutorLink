import type { ReactNode } from "react";
import { Building2, MapPin, UserRound } from "lucide-react";
import { formatTime } from "@/pages/prototype/shell-kit/kit/format";
import type { Booking } from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  BookingStatusBadge,
  KindBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { ListRow, TimeBlock } from "@/pages/prototype/shell-kit/kit/components/list-row";

type BookingRowProps = {
  booking: Booking;
  onOpen: (booking: Booking) => void;
  isTutorView?: boolean;
};

// A Booking as a rich row. Tutors see the same row without the Staff
// line (it's always them).
export default function BookingRow({
  booking,
  onOpen,
  isTutorView = false,
}: BookingRowProps): ReactNode {
  const isOffice = booking.location === "In office";
  const staffDetail = { icon: UserRound, text: booking.staff };
  const locationDetail = {
    icon: isOffice ? Building2 : MapPin,
    text: booking.location,
  };
  return (
    <ListRow
      leading={
        <TimeBlock
          time={formatTime(booking.start)}
          caption={`${booking.durationMin} min`}
        />
      }
      title={booking.child}
      subtitle={`${booking.subject} · ${booking.level}`}
      isStruck={booking.status === "Cancelled"}
      badges={
        <>
          <KindBadge kind={booking.kind} />
          <BookingStatusBadge status={booking.status} />
        </>
      }
      details={isTutorView ? [locationDetail] : [staffDetail, locationDetail]}
      onOpen={() => onOpen(booking)}
    />
  );
}
