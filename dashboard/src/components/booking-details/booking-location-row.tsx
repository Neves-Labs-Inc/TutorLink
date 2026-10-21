// Where a Booking happens: a Guardian's Home (with directions) or the office.
import type { ReactNode } from "react";
import { Building2, MapPin } from "lucide-react";
import { DetailRow } from "@/components/kit/components/detail";
import type { BookingDetail } from "@/lib/queries/bookings";

type LocationRowProps = { booking: BookingDetail };

export default function BookingLocationRow({ booking }: LocationRowProps): ReactNode {
  const { home } = booking;
  if (home === null) {
    return (
      <DetailRow icon={Building2} label="Location">
        <p className="font-semibold">In office</p>
        {booking.office_address && (
          <p className="text-(--tl-ink-soft)">{booking.office_address}</p>
        )}
      </DetailRow>
    );
  }

  return (
    <DetailRow icon={MapPin} label="Location">
      <p className="font-semibold">
        {home.label ? `${home.label} home` : "Home"}
      </p>
      <p className="text-(--tl-ink-soft)">{home.address}</p>
      {home.directions && (
        <p className="mt-1 text-[14px] leading-5 text-(--tl-muted)">
          Directions: {home.directions}
        </p>
      )}
    </DetailRow>
  );
}
