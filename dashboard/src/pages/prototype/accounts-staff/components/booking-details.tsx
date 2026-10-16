// A Booking opened from the family week. Stand-in content from the
// BookingSummary; the real details (Change booking, Cancel, Mark
// Completed) belong to the Bookings prototype.
import type { ReactNode } from "react";
import { BookOpen, CalendarDays, ExternalLink, MapPin, User } from "lucide-react";
import { Avatar, BookingStatusBadge, KindBadge } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { DetailRow } from "@/components/kit/components/detail";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { useToast } from "@/components/kit/overlays/use-toast";
import {
  formatGrade,
  formatWeekdayDate,
  formatWireTime,
} from "@/pages/prototype/accounts-staff/lib/labels";
import type { BookingSummary } from "@/pages/prototype/accounts-staff/types/api";

type BookingDetailsProps = {
  booking: BookingSummary;
  backLabel: string;
  onClose: () => void;
};

export default function BookingDetails({ booking, backLabel, onClose }: BookingDetailsProps): ReactNode {
  const { showToast } = useToast();
  const subject = booking.subject
    ? `${booking.subject.name}${booking.subject_level === null ? "" : ` · ${formatGrade(booking.subject_level)}`}`
    : "Evaluation: Subject levels set afterwards";
  const where =
    booking.location === "in_office"
      ? "In office"
      : `${booking.home?.label ? `${booking.home.label}: ` : ""}${booking.home?.address ?? "Home"}`;

  return (
    <DetailOverlay
      isOpen
      onClose={onClose}
      title={`Booking: ${booking.child.name}`}
      backLabel={backLabel}
      phoneMode="page"
      header={
        <div className="flex flex-wrap items-center gap-2">
          <KindBadge kind={booking.kind} />
          <BookingStatusBadge status={booking.status} />
        </div>
      }
      footer={
        <Button
          variant="primary"
          icon={ExternalLink}
          isFullWidth
          onClick={() => showToast({ tone: "info", message: "Opens this Booking in Bookings, where it can be changed." })}
        >
          Open in Bookings
        </Button>
      }
    >
      <div className="flex items-center gap-4">
        <Avatar name={booking.child.name} size="lg" />
        <h2 className="kit-display min-w-0 truncate text-[28px] leading-9 font-light">{booking.child.name}</h2>
      </div>
      <div className="mt-6 flex flex-col gap-5">
        <DetailRow icon={CalendarDays} label="When">
          <p className="font-semibold tabular-nums">
            {formatWeekdayDate(booking.scheduled_date)}, {formatWireTime(booking.start_time)} – {formatWireTime(booking.end_time)}
          </p>
        </DetailRow>
        <DetailRow icon={BookOpen} label="Subject">
          <p className="font-semibold">{subject}</p>
        </DetailRow>
        <DetailRow icon={User} label="Staff">
          <p className="font-semibold">{booking.staff.name}</p>
        </DetailRow>
        <DetailRow icon={MapPin} label="Location">
          <p className="font-semibold">{where}</p>
        </DetailRow>
      </div>
    </DetailOverlay>
  );
}
