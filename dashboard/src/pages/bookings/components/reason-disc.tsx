// A phone row's trailing mark for a Booking's first Needs attention
// reason: a warning disc with the reason's icon, named for screen readers.
import type { ReactNode } from "react";
import { BOOKING_REASON } from "@/components/kit/lib/booking-reason";
import type { SortOutReason } from "@/lib/queries/bookings";

type ReasonDiscProps = { reason: SortOutReason };

export default function ReasonDisc({ reason }: ReasonDiscProps): ReactNode {
  const style = BOOKING_REASON[reason];
  const Icon = style.icon;
  return (
    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-(--tl-warning-tint) text-(--tl-warning)">
      <Icon aria-hidden className="size-4" />
      <span className="sr-only">{style.label}</span>
    </span>
  );
}
