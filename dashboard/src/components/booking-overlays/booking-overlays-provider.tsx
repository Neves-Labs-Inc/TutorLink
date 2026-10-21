// Booking details and the booking form, mounted once for the signed-in
// app so Bookings, Home and Families open the same ones through
// useBookingOverlays(). Change booking steps out of details and back:
// Discard or a save returns to them, with focus on their title.
import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import BookingDetailsOverlay from "@/components/booking-details/booking-details-overlay";
import BookingFormOverlay from "@/components/booking-form/booking-form-overlay";
import { getNav, getNavIdForPath } from "@/components/kit/shell/nav";
import type { BookingFormTarget } from "@/hooks/use-booking-form";
import { BookingOverlaysContext } from "@/hooks/use-booking-overlays";
import type { BookingOverlays } from "@/hooks/use-booking-overlays";
import { useAuthStore } from "@/stores/authStore";

const FALLBACK_BACK_LABEL = "Back";

type FormSession = { key: number; target: BookingFormTarget };

type BookingOverlaysProviderProps = { children: ReactNode };

export default function BookingOverlaysProvider({
  children,
}: BookingOverlaysProviderProps): ReactNode {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const role = useAuthStore((state) => state.role);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  // The last form opened stays mounted while it plays its exit.
  const [session, setSession] = useState<FormSession | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [titleFocusKey, setTitleFocusKey] = useState(0);
  const sessionCountRef = useRef(0);

  const overlays = useMemo<BookingOverlays>(() => {
    function openForm(target: BookingFormTarget): void {
      sessionCountRef.current += 1;
      setDetailsId(null);
      setSession({ key: sessionCountRef.current, target });
      setIsFormOpen(true);
    }
    return {
      openBooking: (id) => {
        setIsFormOpen(false);
        setDetailsId(id);
      },
      openNewBooking: (prefill = {}) => openForm({ mode: "new", prefill }),
      openChangeBooking: (id) => openForm({ mode: "change", bookingId: id }),
    };
  }, []);

  const navId = getNavIdForPath(pathname);
  const backLabel =
    (role && getNav(role).find((item) => item.id === navId)?.label) ??
    FALLBACK_BACK_LABEL;

  function returnToDetails(bookingId: string): void {
    setIsFormOpen(false);
    setDetailsId(bookingId);
    setTitleFocusKey((key) => key + 1);
  }

  function handleFormClose(): void {
    const target = session?.target;
    if (target?.mode === "change") {
      returnToDetails(target.bookingId);
    } else {
      setIsFormOpen(false);
    }
  }

  function handleOpenChat(conversationId: string): void {
    setIsFormOpen(false);
    setDetailsId(null);
    navigate(`/chats/${conversationId}`);
  }

  return (
    <BookingOverlaysContext value={overlays}>
      {children}
      <BookingDetailsOverlay
        bookingId={detailsId}
        backLabel={backLabel}
        titleFocusKey={titleFocusKey}
        onClose={() => setDetailsId(null)}
        onChangeBooking={(booking) => overlays.openChangeBooking(booking.id)}
      />
      {session && (
        <BookingFormOverlay
          key={session.key}
          target={session.target}
          isOpen={isFormOpen}
          backLabel={backLabel}
          onClose={handleFormClose}
          onChanged={returnToDetails}
          onOpenBooking={overlays.openBooking}
          onOpenChat={handleOpenChat}
        />
      )}
    </BookingOverlaysContext>
  );
}
