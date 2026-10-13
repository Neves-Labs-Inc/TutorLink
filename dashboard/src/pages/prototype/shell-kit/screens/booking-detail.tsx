// Booking details in the kit's DetailOverlay, with the Change and
// Cancel actions and a destructive confirm. Shared by several screens.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Building2,
  CalendarDays,
  MapPin,
  MessageCircle,
  Users,
} from "lucide-react";
import {
  formatDay,
  formatTimeRange,
  getDayKey,
} from "@/pages/prototype/shell-kit/kit/format";
import type { Booking } from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  Avatar,
  BookingStatusBadge,
  KindBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow, NotesCard } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import type { PhoneDetailMode } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";

const FAKE_SAVE_MS = 900;

type BookingDetailProps = {
  booking: Booking | null;
  onClose: () => void;
  phoneMode: PhoneDetailMode;
  backLabel?: string;
};

export default function BookingDetail({
  booking,
  onClose,
  phoneMode,
  backLabel = "Bookings",
}: BookingDetailProps): ReactNode {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const { showToast } = useToast();

  function handleConfirmCancel(): void {
    if (!booking) return;
    setIsCancelling(true);
    window.setTimeout(() => {
      setIsCancelling(false);
      setIsConfirmOpen(false);
      onClose();
      showToast({
        tone: "success",
        message: `Booking for ${booking.child} cancelled.`,
        actionLabel: "Undo",
        onAction: () =>
          showToast({ tone: "info", message: "Booking restored." }),
      });
    }, FAKE_SAVE_MS);
  }

  if (!booking) return null;

  const isOffice = booking.location === "In office";
  const isLive = booking.status === "Pending" || booking.status === "Confirmed";
  return (
    <>
      <DetailOverlay
        isOpen
        onClose={onClose}
        title={`Booking: ${booking.child}`}
        backLabel={backLabel}
        phoneMode={phoneMode}
        header={
          <div className="flex flex-wrap gap-2">
            <KindBadge kind={booking.kind} />
            <BookingStatusBadge status={booking.status} />
          </div>
        }
        footer={
          isLive ? (
            <>
              <Button variant="primary" isFullWidth className="@md:flex-1">
                Change booking
              </Button>
              <Button
                variant="danger-outline"
                isFullWidth
                className="@md:flex-1"
                onClick={() => setIsConfirmOpen(true)}
              >
                Cancel booking
              </Button>
            </>
          ) : undefined
        }
      >
        <h2 className="kit-display text-[28px] leading-9 font-light">
          {booking.child}
        </h2>
        <p className="text-[14px] text-(--tl-muted)">
          Subject level: {booking.subject} · {booking.level}
        </p>
        <div className="mt-6 flex flex-col gap-5">
          <DetailRow icon={CalendarDays} label="When">
            <p className="font-semibold">
              {formatDay(getDayKey(booking.start), {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
            <p className="text-(--tl-ink-soft) tabular-nums">
              {formatTimeRange(booking)} · {booking.durationMin} min
            </p>
          </DetailRow>
          <DetailRow icon={Users} label="Staff">
            <span className="flex items-center gap-2 font-semibold">
              <Avatar name={booking.staff} size="sm" />
              {booking.staff}
            </span>
          </DetailRow>
          <DetailRow icon={isOffice ? Building2 : MapPin} label="Location">
            <p className="font-semibold">{booking.location}</p>
            {booking.directions && (
              <p className="text-(--tl-ink-soft)">{booking.directions}</p>
            )}
          </DetailRow>
          <DetailRow icon={MessageCircle} label="Guardian">
            <p className="font-semibold">{booking.guardian}</p>
            <TextLink>Open chat</TextLink>
          </DetailRow>
          {booking.childNotes && <NotesCard>{booking.childNotes}</NotesCard>}
        </div>
      </DetailOverlay>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={handleConfirmCancel}
        title="Cancel this booking?"
        confirmLabel="Cancel booking"
        keepLabel="Keep booking"
        isDestructive
        isWorking={isCancelling}
      >
        {booking.child}’s {booking.subject} booking on{" "}
        {formatDay(getDayKey(booking.start), {
          weekday: "long",
          month: "short",
          day: "numeric",
        })}{" "}
        will be cancelled, and {booking.staff}’s time frees up.
      </ConfirmDialog>
    </>
  );
}
