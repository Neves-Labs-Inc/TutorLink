// /bookings/:id opens that Booking's details over the page, then the URL
// drops back to /bookings (keeping the filters), so closing the details
// leaves the page where it is. Focus goes to the page title first, so
// closing returns it there.
import { useEffect } from "react";
import type { RefObject } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useBookingOverlays } from "@/hooks/use-booking-overlays";

const BOOKINGS_PATH = "/bookings";

export function useBookingDeepLink(
  rootRef: RefObject<HTMLElement | null>,
): void {
  const { id } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const { openBooking } = useBookingOverlays();

  useEffect(() => {
    if (!id) return;
    const title = rootRef.current?.querySelector<HTMLElement>("h1");
    if (title) {
      // Focusable from script only, so the details can hand focus back.
      title.tabIndex = -1;
      title.focus();
    }
    openBooking(id);
    navigate({ pathname: BOOKINGS_PATH, search }, { replace: true });
    // Only a new id in the path opens details.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
}
