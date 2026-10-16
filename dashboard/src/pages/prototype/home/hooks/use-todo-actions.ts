// The writes To do makes, faked with a short delay. Every one but Mark
// done runs from a details slide-over, never from a row.
//   Approve        PATCH /api/exceptions/{id} {status: "approved",
//                  confirm_warnings: ["booking_clash"]}: one tap, even
//                  over clashing Bookings (TutorLink#189).
//   Decline        the same with "rejected", after a confirm, no note.
//   Mark done      POST /api/conversations/{id}/handled {flagged_at}; the
//                  list has no flagged_at, so the real page reads the
//                  chat first (open question).
//   Completed /    PATCH the Booking's status (completed / cancelled).
//   Didn't happen
//   Keep booking   POST the clash acknowledgement (Admin only).
//   Cancel booking PATCH status cancelled.
//   Change booking and Book evaluation open forms owned by the Bookings
//   prototype; here they only toast.
// No Undo on the toasts: none of these writes can be taken back.
import { useRef, useState } from "react";
import { useToast } from "@/components/kit/overlays/use-toast";
import { pluralize } from "@/components/kit/format";
import type { HomeDataApi } from "@/pages/prototype/home/hooks/use-home-data";
import { getDisplayName } from "@/pages/prototype/home/lib/labels";
import { toClashBooking } from "@/pages/prototype/home/lib/mock-api";
import type {
  BookingSummary,
  ChildSummary,
  ConversationSummary,
  ExceptionRead,
} from "@/pages/prototype/home/types/api";

const FAKE_WRITE_MS = 450;

export type BookingOutcome = "completed" | "didnt-happen" | "kept" | "cancelled";

const OUTCOME_TOAST: Record<BookingOutcome, string> = {
  completed: "Marked Completed",
  "didnt-happen": "Marked Didn’t happen",
  kept: "Kept",
  cancelled: "Cancelled",
};

export type TodoActions = {
  busyId: string | null;
  declineTarget: ExceptionRead | null;
  // `onDone` closes the details the act was taken from, once it lands.
  approve: (item: ExceptionRead, onDone: () => void) => void;
  requestDecline: (item: ExceptionRead, onDone: () => void) => void;
  cancelDecline: () => void;
  confirmDecline: () => void;
  markDone: (chat: ConversationSummary) => void;
  resolveBooking: (
    booking: BookingSummary,
    outcome: BookingOutcome,
    onDone: () => void,
  ) => void;
  openChangeBooking: (booking: BookingSummary) => void;
  openBookEvaluation: (child: ChildSummary) => void;
};

function getFirstName(name: string): string {
  return name.split(" ")[0];
}

export function useTodoActions(api: HomeDataApi): TodoActions {
  const { showToast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<ExceptionRead | null>(null);
  const onDeclinedRef = useRef<() => void>(() => undefined);

  function runWrite(id: string, onDone: () => void): void {
    setBusyId(id);
    window.setTimeout(() => {
      setBusyId(null);
      onDone();
    }, FAKE_WRITE_MS);
  }

  function approve(item: ExceptionRead, onDone: () => void): void {
    const clashes = item.clashing_bookings.map((clash) => toClashBooking(item, clash));
    runWrite(item.id, () => {
      onDone();
      api.removeTimeOff(item, clashes);
      const name = getFirstName(item.staff.name);
      showToast({
        tone: "success",
        message:
          clashes.length > 0
            ? `Approved ${name}’s time off. ${pluralize(clashes.length, "Booking", "Bookings")} to change, now in To do.`
            : `Approved ${name}’s time off.`,
      });
    });
  }

  function requestDecline(item: ExceptionRead, onDone: () => void): void {
    onDeclinedRef.current = onDone;
    setDeclineTarget(item);
  }

  function confirmDecline(): void {
    if (!declineTarget) return;
    const target = declineTarget;
    runWrite(target.id, () => {
      setDeclineTarget(null);
      onDeclinedRef.current();
      api.removeTimeOff(target, []);
      showToast({
        tone: "success",
        message: `Declined ${getFirstName(target.staff.name)}’s time off.`,
      });
    });
  }

  function markDone(chat: ConversationSummary): void {
    runWrite(chat.id, () => {
      api.removeChat(chat.id);
      showToast({
        tone: "success",
        message: `Marked done: ${getDisplayName(chat)}.`,
      });
    });
  }

  function resolveBooking(
    booking: BookingSummary,
    outcome: BookingOutcome,
    onDone: () => void,
  ): void {
    runWrite(booking.id, () => {
      onDone();
      api.removeSortOut(booking.id);
      showToast({
        tone: "success",
        message: `${OUTCOME_TOAST[outcome]}: ${booking.child.name}’s booking.`,
      });
    });
  }

  function openChangeBooking(booking: BookingSummary): void {
    showToast({
      tone: "info",
      message: `Prototype: Change booking for ${booking.child.name} opens here (Bookings prototype).`,
    });
  }

  function openBookEvaluation(child: ChildSummary): void {
    showToast({
      tone: "info",
      message: `Prototype: New booking opens with ${child.name} and Evaluation filled in (Bookings prototype).`,
    });
  }

  return {
    busyId,
    declineTarget,
    approve,
    requestDecline,
    cancelDecline: () => setDeclineTarget(null),
    confirmDecline,
    markDone,
    resolveBooking,
    openChangeBooking,
    openBookEvaluation,
  };
}
