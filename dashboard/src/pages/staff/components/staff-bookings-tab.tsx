// Staff details ▸ Bookings: the next ten live Bookings, each opening
// the Booking, and a link to all of them in Bookings.
import type { ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/kit/components/button";
import { EmptyState, InlineError, ListSkeleton } from "@/components/kit/states/states";
import { CARD, cn } from "@/components/kit/tokens";
import type { StaffRead } from "@/lib/queries/staff";
import StaffBookingRow from "@/pages/staff/components/staff-booking-row";
import { useStaffBookings } from "@/pages/staff/hooks/use-staff-bookings";

type StaffBookingsTabProps = { staff: StaffRead };

export default function StaffBookingsTab({ staff }: StaffBookingsTabProps): ReactNode {
  const navigate = useNavigate();
  const { bookings, hasFailed, isRetrying, retry } = useStaffBookings(staff.id);

  let body: ReactNode = <ListSkeleton rows={3} label="Loading Bookings" />;
  if (hasFailed) {
    body = (
      <InlineError
        message="Couldn’t load their Bookings. Check your connection and try again."
        onRetry={retry}
        isRetrying={isRetrying}
      />
    );
  } else if (bookings?.length === 0) {
    body = <EmptyState isBare icon={CalendarDays} title="Nothing booked ahead" />;
  } else if (bookings) {
    body = (
      <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
        {bookings.map((booking) => (
          <StaffBookingRow
            key={booking.id}
            booking={booking}
            onOpen={(id) => navigate(`/bookings/${id}`)}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col">
      {body}
      {!hasFailed && bookings && (
        <Button
          variant="ghost"
          className="mt-3 self-start"
          onClick={() => navigate(`/bookings?staff=${staff.id}`)}
        >
          See all in Bookings
        </Button>
      )}
    </div>
  );
}
