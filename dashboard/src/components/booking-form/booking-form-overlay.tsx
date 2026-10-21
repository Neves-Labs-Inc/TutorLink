// New booking and Change booking (DESIGN §11.5): one form, shared by
// Bookings, Home and Families, in the same slide-over as Booking details
// (a pushed page on phones). Keep it mounted and drive it with isOpen,
// so it plays its exit; remount it (a new key) for each opening.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { prefersReducedMotion } from "@/components/kit/overlays/use-enter-animation";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import BookingFormBody from "@/components/booking-form/booking-form-body";
import { useBookingForm } from "@/hooks/use-booking-form";
import type { BookingFormState, BookingFormTarget } from "@/hooks/use-booking-form";

const SKELETON_FIELDS = 5;
const FOCUSABLE = "input:not([disabled]), button:not([disabled]), textarea";

type BookingFormOverlayProps = {
  target: BookingFormTarget;
  isOpen: boolean;
  backLabel: string;
  onClose: () => void;
  onChanged: (bookingId: string) => void;
  onOpenBooking: (bookingId: string) => void;
  onOpenChat: (conversationId: string) => void;
};

function getSubmitLabel(form: BookingFormState): string {
  let label = form.isChange ? "Save changes" : "Book";
  if (form.isSaving) {
    label = form.isChange ? "Saving…" : "Booking…";
  } else if (form.warnings.length > 0) {
    label = form.isChange ? "Save anyway" : "Book anyway";
  }
  return label;
}

export default function BookingFormOverlay({
  target,
  isOpen,
  backLabel,
  onClose,
  onChanged,
  onOpenBooking,
  onOpenChat,
}: BookingFormOverlayProps): ReactNode {
  const form = useBookingForm({
    target,
    isOpen,
    onClose,
    onChanged,
    onOpenBooking,
    onOpenChat,
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const title = form.isChange ? "Change booking" : "New booking";

  // A refused submit moves focus to the first field with an error.
  const { invalidFocus } = form;
  useEffect(() => {
    if (invalidFocus === null) return;
    const control = bodyRef.current?.querySelector<HTMLElement>(
      `[data-field="${invalidFocus.field}"] :is(${FOCUSABLE})`,
    );
    control?.focus({ preventScroll: true });
    control?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "center",
    });
  }, [invalidFocus]);

  let content: ReactNode = <BookingFormBody form={form} />;
  if (form.loadError) {
    content = (
      <div className="pt-2">
        <InlineError
          message={form.loadError.message}
          onRetry={form.loadError.retry}
          isRetrying={form.loadError.isRetrying}
        />
      </div>
    );
  } else if (form.isFormLoading) {
    content = <BookingFormSkeleton />;
  }
  const isReady = !form.loadError && !form.isFormLoading;

  return (
    <DetailOverlay
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      backLabel={form.isChange ? "Booking" : backLabel}
      phoneMode="page"
      isHeaderPinned
      header={
        <h2 className="kit-display text-[22px] leading-[30px] font-bold">{title}</h2>
      }
      footer={
        <>
          <Button
            variant="primary"
            isFullWidth
            className="@md:flex-1"
            isLoading={form.isSaving}
            disabled={!isReady}
            onClick={() => void form.submit()}
          >
            {getSubmitLabel(form)}
          </Button>
          <Button
            variant="outline"
            isFullWidth
            className="@md:flex-1"
            disabled={form.isSaving}
            onClick={onClose}
          >
            Discard
          </Button>
        </>
      }
    >
      <div ref={bodyRef}>{content}</div>
    </DetailOverlay>
  );
}

function BookingFormSkeleton(): ReactNode {
  return (
    <div role="status" aria-label="Loading booking form" className="flex flex-col gap-4 pt-2">
      {Array.from({ length: SKELETON_FIELDS }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-20 rounded-full" />
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
      ))}
    </div>
  );
}
