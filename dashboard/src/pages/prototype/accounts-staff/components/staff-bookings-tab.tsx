// Bookings: upcoming live (Confirmed / Pending) Bookings only, compact
// rows that open the Booking, and "See all in Bookings" filtered to this
// person (GET /api/bookings?staff_id=...&status=confirmed,pending).
import type { ReactNode } from "react";
import { CalendarDays, ChevronRight } from "lucide-react";
import { CARD, cn } from "@/components/kit/tokens";
import {
  BookingStatusBadge,
  KindBadge,
} from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { useToast } from "@/components/kit/overlays/use-toast";
import { EmptyState } from "@/components/kit/states/states";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  formatBookingWhat,
  formatBookingWhen,
} from "@/pages/prototype/accounts-staff/lib/labels";
import { getUpcomingBookings } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { StaffRead } from "@/pages/prototype/accounts-staff/types/api";

type StaffBookingsTabProps = { staff: StaffRead };

export default function StaffBookingsTab({ staff }: StaffBookingsTabProps): ReactNode {
  const { db } = useArea();
  const { showToast } = useToast();
  const bookings = getUpcomingBookings(db, (b) => b.staff.id === staff.id);

  function handleSeeAll(): void {
    showToast({ tone: "info", message: `Opens Bookings filtered to ${staff.name}.` });
  }

  if (bookings.length === 0) {
    return (
      <EmptyState
        isBare
        icon={CalendarDays}
        title="Nothing booked ahead"
        body={`${staff.name} has no upcoming Confirmed or Pending Bookings.`}
        action={<Button onClick={handleSeeAll}>See all in Bookings</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
        {bookings.map((booking) => (
          <li key={booking.id}>
            <button
              type="button"
              onClick={() => showToast({ tone: "info", message: "Opens Booking details (the Bookings prototype)." })}
              className="flex min-h-[64px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-(--tl-tint) focus-visible:-outline-offset-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold tabular-nums">{formatBookingWhen(booking)}</span>
                <span className="block truncate text-[13px] text-(--tl-muted)">{formatBookingWhat(booking)}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <BookingStatusBadge status={booking.status} />
                {booking.kind === "evaluation" && <KindBadge kind={booking.kind} />}
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
            </button>
          </li>
        ))}
      </ul>
      <div>
        <Button variant="ghost" onClick={handleSeeAll}>
          See all in Bookings
        </Button>
      </div>
    </div>
  );
}
