// Opens Booking details or the booking form from any signed-in page.
// BookingOverlaysProvider (in the app layout) owns both overlays.
import { createContext, useContext } from "react";
import type { BookingFormPrefill } from "@/lib/bookings/booking-form";

export type { BookingFormPrefill };

export type BookingOverlays = {
  openBooking: (id: string) => void;
  openNewBooking: (prefill?: BookingFormPrefill) => void;
  openChangeBooking: (id: string) => void;
};

export const BookingOverlaysContext = createContext<BookingOverlays | null>(null);

export function useBookingOverlays(): BookingOverlays {
  const overlays = useContext(BookingOverlaysContext);
  if (!overlays) {
    throw new Error("useBookingOverlays needs a <BookingOverlaysProvider> above it");
  }
  return overlays;
}
