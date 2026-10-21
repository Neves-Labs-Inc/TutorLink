// Booking details (DESIGN §11.3, §11.4, §11.6): the one place every act on
// a Booking lives. Bookings, Home and Families open it with their own back
// label. Keep it mounted and drive it with bookingId, so it plays its exit.
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { ReactNode } from "react";
import { CalendarX2 } from "lucide-react";
import { useNow } from "@/components/kit/hooks/use-now";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { EmptyState, InlineError } from "@/components/kit/states/states";
import BookingDetailsBody from "@/components/booking-details/booking-details-body";
import BookingDetailsFooter from "@/components/booking-details/booking-details-footer";
import BookingDetailsHeader from "@/components/booking-details/booking-details-header";
import BookingDetailsSkeleton from "@/components/booking-details/booking-details-skeleton";
import { useBookingDetails } from "@/hooks/use-booking-details";
import { ADMIN_ROLES } from "@/lib/auth/auth";
import {
  describeBookingTime,
  getBookingActs,
  getGuardianToTell,
  STATUS_WORDS,
} from "@/lib/bookings/booking-details";
import type { BookingAct } from "@/lib/bookings/booking-details";
import type { BookingDetail } from "@/lib/queries/bookings";
import { useAuthStore } from "@/stores/authStore";

type BookingDetailsOverlayProps = {
  bookingId: string | null;
  backLabel: string;
  onClose: () => void;
  onChangeBooking: (booking: BookingDetail) => void;
};

export default function BookingDetailsOverlay({
  bookingId,
  backLabel,
  onClose,
  onChangeBooking,
}: BookingDetailsOverlayProps): ReactNode {
  const role = useAuthStore((state) => state.role);
  // Keep and Stop keeping are the Admins' (and Developers') alone.
  const canKeep = role !== null && ADMIN_ROLES.includes(role);
  const now = useNow();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  // The confirm dialog closes in its own commit before the details do, so
  // its focus return runs first and the details' return to the opener wins.
  function closeAll(): void {
    if (isConfirmOpen) flushSync(() => setIsConfirmOpen(false));
    onClose();
  }
  const details = useBookingDetails({
    bookingId,
    onClose: closeAll,
    onUpdatedInPlace: () => titleRef.current?.focus(),
  });
  const { booking } = details;

  function handleAct(act: BookingAct): void {
    if (!booking) return;
    if (act === "change") {
      onChangeBooking(booking);
    } else if (act === "cancel") {
      setIsConfirmOpen(true);
    } else {
      void details.run(act);
    }
  }

  async function handleConfirmCancel(): Promise<void> {
    await details.run("cancel");
    setIsConfirmOpen(false);
  }

  let title = "Booking";
  let header: ReactNode = null;
  let content: ReactNode = <BookingDetailsSkeleton part="body" />;
  let footer: ReactNode = null;
  if (booking) {
    title = `Booking: ${booking.child.name}`;
    header = (
      <BookingDetailsHeader
        booking={booking}
        titleRef={titleRef}
        onLeave={onClose}
      />
    );
    content = (
      <BookingDetailsBody
        booking={booking}
        canKeep={canKeep}
        restoreWarnings={details.restoreWarnings}
        isBusy={details.busyAct !== null}
        onStopKeeping={() => void details.run("stop_keeping")}
        onOpenChat={details.openChat}
      />
    );
    footer = (
      <BookingDetailsFooter
        acts={getBookingActs(booking, { canKeep, now: new Date(now) })}
        statusWords={STATUS_WORDS[booking.status]}
        busyAct={details.busyAct}
        feedback={details.feedback}
        hasRestoreWarnings={details.restoreWarnings !== null}
        onAct={handleAct}
      />
    );
  } else if (details.isNotFound) {
    content = (
      <EmptyState
        isBare
        icon={CalendarX2}
        title="This booking doesn’t exist any more"
        body="It was removed, or the link is out of date."
      />
    );
  } else if (details.isLoadError) {
    content = (
      <InlineError
        message="Couldn’t load this booking. Check your connection and try again."
        onRetry={details.retry}
        isRetrying={details.isRetrying}
      />
    );
  } else {
    header = <BookingDetailsSkeleton part="header" />;
  }

  return (
    <>
      <DetailOverlay
        isOpen={bookingId !== null}
        onClose={onClose}
        title={title}
        backLabel={backLabel}
        phoneMode="page"
        isHeaderPinned
        header={header}
        footer={footer}
      >
        <div className="pt-2">{content}</div>
      </DetailOverlay>
      <ConfirmDialog
        isOpen={isConfirmOpen && booking !== null}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={() => void handleConfirmCancel()}
        title="Cancel this booking?"
        confirmLabel="Cancel booking"
        keepLabel="Keep booking"
        isDestructive
        isWorking={details.busyAct === "cancel"}
      >
        {booking && (
          <>
            {booking.child.name} with {booking.staff.name},{" "}
            {describeBookingTime(booking)}. TutorLink doesn’t message the
            Guardian: let {getGuardianToTell(booking).name} know yourself.
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
