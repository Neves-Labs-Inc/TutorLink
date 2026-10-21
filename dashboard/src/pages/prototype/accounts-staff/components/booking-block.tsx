// One Booking in the family week, as the kit's BookingBlock. This adapter
// maps the wire Booking to the kit's display strings.
import type { ReactNode } from "react";
import KitBookingBlock from "@/components/kit/components/booking-block";
import type { ChildTone } from "@/components/kit/lib/child-tones";
import { formatWireTime } from "@/pages/prototype/accounts-staff/lib/labels";
import type { BookingSummary } from "@/pages/prototype/accounts-staff/types/api";

type BookingBlockProps = {
  booking: BookingSummary;
  tone: ChildTone;
  onOpen: (id: string) => void;
};

export default function BookingBlock({ booking, tone, onOpen }: BookingBlockProps): ReactNode {
  const isEvaluation = booking.kind === "evaluation";
  const [firstName] = booking.child.name.split(" ");
  return (
    <KitBookingBlock
      layout="stack"
      time={formatWireTime(booking.start_time)}
      name={firstName}
      fullName={booking.child.name}
      what={isEvaluation ? "Evaluation" : (booking.subject?.name ?? "Tutoring")}
      isEvaluation={isEvaluation}
      staffName={booking.staff.name}
      status={booking.status}
      tone={tone}
      onOpen={() => onOpen(booking.id)}
    />
  );
}
