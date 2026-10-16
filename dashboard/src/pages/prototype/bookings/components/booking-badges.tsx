// Badges for a Booking. Every Booking is created Confirmed, so
// Confirmed is the quiet default and gets no badge; only Completed and
// Cancelled show. Sort-out reasons are warning badges with their own icon.
import type { ReactNode } from "react";
import {
  Badge,
  BookingStatusBadge,
  KindBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import {
  KIND_LABEL,
  REASON_LABEL,
  STATUS_LABEL,
} from "@/pages/prototype/bookings/lib/format";
import { REASON_ICON } from "@/pages/prototype/bookings/lib/reason-icons";
import type {
  BookingSummary,
  SortOutReason,
} from "@/pages/prototype/bookings/lib/wire";

type ReasonBadgeProps = { reason: SortOutReason };

export function ReasonBadge({ reason }: ReasonBadgeProps): ReactNode {
  return (
    <Badge tone="warning" icon={REASON_ICON[reason]}>
      {REASON_LABEL[reason]}
    </Badge>
  );
}

type BookingBadgesProps = {
  booking: Pick<BookingSummary, "kind" | "status" | "sort_out_reasons">;
  hasKind?: boolean;
};

export default function BookingBadges({
  booking,
  hasKind = true,
}: BookingBadgesProps): ReactNode {
  const hasStatus = booking.status === "completed" || booking.status === "cancelled";
  return (
    <>
      {booking.sort_out_reasons.map((reason) => (
        <ReasonBadge key={reason} reason={reason} />
      ))}
      {hasKind && <KindBadge kind={KIND_LABEL[booking.kind]} />}
      {hasStatus && <BookingStatusBadge status={STATUS_LABEL[booking.status]} />}
    </>
  );
}
