// Booking details (GET /api/bookings/{id}) in the kit's DetailOverlay.
// A Booking that needs attention opens with a callout that says why, and the
// footer holds the acts that fit its state: Change booking / Cancel
// booking while it is live and ahead, Completed / Didn't happen once
// its date has passed, nothing once it is Completed or Cancelled.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  BookOpen,
  Building2,
  CalendarDays,
  History,
  MapPin,
  MessageCircle,
  Users,
} from "lucide-react";
import {
  Avatar,
  BookingStatusBadge,
  KindBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow, NotesCard } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { ReasonBadge } from "@/pages/prototype/bookings/components/booking-badges";
import {
  formatDateTime,
  formatDay,
  formatGrade,
  formatLongDay,
  formatTimeRange,
  getDurationMinutes,
  getFirstName,
  KIND_LABEL,
  STATUS_LABEL,
} from "@/pages/prototype/bookings/lib/format";
import { findTimeOffFor, isLive, isPast } from "@/pages/prototype/bookings/lib/rules";
import type { BookingDetail, UserRole } from "@/pages/prototype/bookings/lib/wire";

const FAKE_SAVE_MS = 900;

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  manager: "Manager",
  tutor: "Tutor",
  developer: "Developer",
};

export type DetailActions = {
  onChange: (booking: BookingDetail) => void;
  onCancelled: (booking: BookingDetail) => void;
  onComplete: (booking: BookingDetail) => void;
  onDidntHappen: (booking: BookingDetail) => void;
  onKeep: (booking: BookingDetail) => void;
  onUndoKeep: (booking: BookingDetail) => void;
  onOpenChild: (booking: BookingDetail) => void;
  onOpenChat: (guardianName: string) => void;
};

type SortOutCalloutProps = {
  booking: BookingDetail;
  isAdmin: boolean;
  onKeep: () => void;
};

function SortOutCallout({ booking, isAdmin, onKeep }: SortOutCalloutProps): ReactNode {
  const timeOff = findTimeOffFor(booking);
  const staff = getFirstName(booking.staff.name);
  const lines = booking.sort_out_reasons.map((reason) => {
    if (reason === "not_completed") {
      return `${formatDay(booking.scheduled_date, { weekday: "long" })} has passed and nobody marked this booking. Did it happen?`;
    }
    if (reason === "time_off_clash") {
      return `${booking.staff.name} has approved Time off ${timeOff?.start_date === timeOff?.end_date ? "that day" : "over these dates"}${timeOff?.reason ? ` (${timeOff.reason})` : ""}. Change the booking, or keep it if ${staff} will still teach.`;
    }
    return `${booking.staff.name} is archived. Give this booking to someone else, or cancel it.`;
  });
  const hasClash = booking.sort_out_reasons.includes("time_off_clash");

  return (
    <div className="mt-5 rounded-[18px] border border-(--tl-warning)/30 bg-(--tl-warning-tint) p-4 text-(--tl-warning)">
      <p className="text-[13px] font-semibold tracking-[0.1em] uppercase">Needs attention</p>
      <ul className="mt-1.5 flex flex-col gap-1.5 text-[14px] leading-6">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {hasClash && isAdmin && (
        <Button className="mt-3" onClick={onKeep}>
          Keep booking
        </Button>
      )}
      {hasClash && !isAdmin && (
        <p className="mt-2 text-[13px]">Only an Admin can keep a booking over Time off.</p>
      )}
    </div>
  );
}

type BookingDetailPanelProps = {
  booking: BookingDetail | null;
  role: "admin" | "manager";
  onClose: () => void;
  actions: DetailActions;
  isCancelConfirmOpen?: boolean;
};

export default function BookingDetailPanel({
  booking,
  role,
  onClose,
  actions,
  isCancelConfirmOpen = false,
}: BookingDetailPanelProps): ReactNode {
  const [isConfirmOpen, setIsConfirmOpen] = useState(isCancelConfirmOpen);
  const [isCancelling, setIsCancelling] = useState(false);
  const isAdmin = role === "admin";

  if (!booking) return null;

  function handleConfirmCancel(): void {
    if (!booking) return;
    setIsCancelling(true);
    window.setTimeout(() => {
      setIsCancelling(false);
      setIsConfirmOpen(false);
      actions.onCancelled(booking);
    }, FAKE_SAVE_MS);
  }

  const isLiveBooking = isLive(booking.status);
  const hasPassed = isPast(booking);
  const timeOff = findTimeOffFor(booking);
  const isKept = Boolean(booking.clash_acknowledged_at && timeOff);
  const subjectLine =
    booking.kind === "evaluation" || !booking.subject
      ? "Evaluation · assesses Subject levels"
      : `${booking.subject.name} · ${formatGrade(booking.subject_level)}`;
  // Tell whoever booked it; an office booking goes to the first Guardian.
  const mainGuardian =
    booking.booked_by_guardian?.name ?? booking.guardians[0]?.name ?? "the Guardian";

  let footer: ReactNode = undefined;
  if (isLiveBooking && hasPassed) {
    footer = (
      <>
        <Button variant="primary" isFullWidth className="@md:flex-1" onClick={() => actions.onComplete(booking)}>
          Completed
        </Button>
        <Button isFullWidth className="@md:flex-1" onClick={() => actions.onDidntHappen(booking)}>
          Didn’t happen
        </Button>
      </>
    );
  } else if (isLiveBooking) {
    footer = (
      <>
        <Button variant="primary" isFullWidth className="@md:flex-1" onClick={() => actions.onChange(booking)}>
          Change booking
        </Button>
        <Button variant="danger-outline" isFullWidth className="@md:flex-1" onClick={() => setIsConfirmOpen(true)}>
          Cancel booking
        </Button>
      </>
    );
  }

  return (
    <>
      <DetailOverlay
        isOpen
        onClose={onClose}
        title={`Booking: ${booking.child.name}`}
        backLabel="Bookings"
        phoneMode="page"
        header={
          <div className="flex flex-wrap gap-2">
            {booking.sort_out_reasons.map((reason) => (
              <ReasonBadge key={reason} reason={reason} />
            ))}
            <KindBadge kind={KIND_LABEL[booking.kind]} />
            <BookingStatusBadge status={STATUS_LABEL[booking.status]} />
          </div>
        }
        footer={footer}
      >
        <h2 className="kit-display text-[28px] leading-9 font-light">
          <button
            type="button"
            onClick={() => actions.onOpenChild(booking)}
            className="cursor-pointer text-left underline-offset-4 hover:underline"
          >
            {booking.child.name}
          </button>
        </h2>
        <p className="text-[14px] text-(--tl-muted)">{subjectLine}</p>

        {booking.sort_out_reasons.length > 0 && (
          <SortOutCallout booking={booking} isAdmin={isAdmin} onKeep={() => actions.onKeep(booking)} />
        )}
        {isKept && booking.clash_acknowledged_by && booking.clash_acknowledged_at && (
          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[18px] bg-(--tl-neutral-tint) px-4 py-3 text-[14px] text-(--tl-neutral)">
            <span className="min-w-0 flex-1">
              Kept over {getFirstName(booking.staff.name)}’s Time off by{" "}
              {booking.clash_acknowledged_by.name} ·{" "}
              {formatDateTime(booking.clash_acknowledged_at)}
            </span>
            {isAdmin && isLiveBooking && (
              <TextLink onClick={() => actions.onUndoKeep(booking)}>Undo</TextLink>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-5">
          <DetailRow icon={CalendarDays} label="When">
            <p className="font-semibold">{formatLongDay(booking.scheduled_date)}</p>
            <p className="text-(--tl-ink-soft) tabular-nums">
              {formatTimeRange(booking.start_time, booking.end_time)} ·{" "}
              {getDurationMinutes(booking.start_time, booking.end_time)} min
            </p>
          </DetailRow>
          <DetailRow icon={Users} label="Staff">
            <span className="flex items-center gap-2 font-semibold">
              <Avatar name={booking.staff.name} size="sm" />
              {booking.staff.name}
              <span className="font-normal text-(--tl-muted)">· {ROLE_LABEL[booking.staff.role]}</span>
            </span>
          </DetailRow>
          <DetailRow icon={booking.home ? MapPin : Building2} label="Location">
            {booking.home ? (
              <>
                <p className="font-semibold">
                  {booking.home.label ? `${booking.home.label} home` : "Home"}
                </p>
                <p className="text-(--tl-ink-soft)">{booking.home.address}</p>
                {booking.home.directions && (
                  <p className="mt-1 text-[14px] text-(--tl-muted)">
                    Directions: {booking.home.directions}
                  </p>
                )}
              </>
            ) : (
              <p className="font-semibold">In office</p>
            )}
          </DetailRow>
          <DetailRow icon={MessageCircle} label={booking.guardians.length > 1 ? "Guardians" : "Guardian"}>
            <ul className="flex flex-col gap-1">
              {booking.guardians.map((guardian) => (
                <li key={guardian.id} className="flex flex-wrap items-center gap-x-3">
                  <span className="font-semibold">{guardian.name}</span>
                  {guardian.conversation_id ? (
                    <TextLink onClick={() => actions.onOpenChat(guardian.name)}>Open chat</TextLink>
                  ) : (
                    <span className="text-[14px] text-(--tl-muted)">No chat yet</span>
                  )}
                </li>
              ))}
            </ul>
          </DetailRow>
          <DetailRow icon={History} label="Booked">
            <p>
              {booking.booked_by_guardian
                ? `By ${booking.booked_by_guardian.name}, through the bot`
                : "By the office"}
            </p>
          </DetailRow>
          {booking.subject && (
            <DetailRow icon={BookOpen} label="Subject level">
              <p>
                {booking.subject.name}: {formatGrade(booking.subject_level)}
              </p>
            </DetailRow>
          )}
          {booking.notes && <NotesCard title="Booking notes">{booking.notes}</NotesCard>}
          {booking.child.notes && (
            <NotesCard title="Notes for tutors">{booking.child.notes}</NotesCard>
          )}
          {!isLiveBooking && (
            <p className="text-[13px] text-(--tl-muted)">
              {STATUS_LABEL[booking.status]} bookings can’t be changed.
            </p>
          )}
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
        {booking.child.name}’s{" "}
        {booking.kind === "evaluation" ? "Evaluation" : booking.subject?.name} on{" "}
        {formatDay(booking.scheduled_date, { weekday: "long", month: "short", day: "numeric" })} will
        be cancelled and {getFirstName(booking.staff.name)}’s time frees up. TutorLink doesn’t message
        the Guardian: let {mainGuardian} know yourself.
      </ConfirmDialog>
    </>
  );
}
