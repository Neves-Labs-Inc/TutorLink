// Booking details' pinned header: why it needs attention, its Kind and
// status, and the Child, linked to their family.
import type { ReactNode, Ref } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import {
  BookingReasonBadge,
  BookingStatusBadge,
  KindBadge,
} from "@/components/kit/components/badges";
import { gradeName } from "@/lib/grades/grades";
import type { BookingDetail } from "@/lib/queries/bookings";

function getSubjectLine(booking: BookingDetail): string {
  let line = "Evaluation";
  if (booking.kind === "regular" && booking.subject) {
    line =
      booking.subject_level === null
        ? booking.subject.name
        : `${booking.subject.name} · ${gradeName(booking.subject_level)}`;
  }
  return line;
}

type BookingDetailsHeaderProps = {
  booking: BookingDetail;
  titleRef: Ref<HTMLHeadingElement>;
  onLeave: () => void;
};

export default function BookingDetailsHeader({
  booking,
  titleRef,
  onLeave,
}: BookingDetailsHeaderProps): ReactNode {
  const childId = booking.child.id;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2">
        {booking.sort_out_reasons.map((reason) => (
          <BookingReasonBadge key={reason} reason={reason} />
        ))}
        <KindBadge kind={booking.kind} />
        {booking.status !== "confirmed" && (
          <BookingStatusBadge status={booking.status} />
        )}
      </div>
      <h2
        ref={titleRef}
        tabIndex={-1}
        className="kit-display mt-2 text-[22px] leading-[30px] font-bold outline-none"
      >
        <Link
          to={`/families/${childId}?child=${childId}`}
          onClick={onLeave}
          className="group inline-flex items-center gap-1 text-(--tl-ink) underline-offset-4 hover:underline"
        >
          {booking.child.name}
          <ChevronRight
            aria-hidden
            className="size-[18px] text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </Link>
      </h2>
      <p className="text-[14px] leading-5 text-(--tl-muted)">
        {getSubjectLine(booking)}
      </p>
    </div>
  );
}
