// Booking details' read and every act on it: the request, the toast with
// Undo, and what a failure says while the details are open (an alert line)
// or once they've closed (an error toast).
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/kit/overlays/use-toast";
import type { ToastInput } from "@/components/kit/overlays/use-toast";
import { conflictOf, errorDetail, errorStatus } from "@/lib/api";
import {
  ACT_FAILED,
  describeBookingTime,
  describeRestoreRefusal,
  getClosedFailure,
  getGuardianToTell,
  STALE_MESSAGE,
  UNDO_FAILED,
} from "@/lib/bookings/booking-details";
import type { WriteAct } from "@/lib/bookings/booking-details";
import {
  acknowledgeClash,
  bookingQueries,
  clearClashAcknowledgement,
  invalidateBookingData,
  updateBookingStatus,
} from "@/lib/queries/bookings";
import type {
  BookingDetail,
  BookingStatus,
  BookingWarning,
} from "@/lib/queries/bookings";

const NOT_FOUND = 404;

export type ActFeedback = { tone: "danger" | "warning"; message: string };

// What a successful write tells the Office, and whether the details stay.
type Outcome = { toast: ToastInput; isClosing: boolean };

type UseBookingDetailsOptions = {
  bookingId: string | null;
  onClose: () => void;
  // Re-open and Restore stay open; focus moves to the title so the next
  // step starts from the refreshed details.
  onUpdatedInPlace: () => void;
};

export type BookingDetailsState = {
  booking: BookingDetail | null;
  isLoading: boolean;
  isNotFound: boolean;
  isLoadError: boolean;
  isRetrying: boolean;
  retry: () => void;
  busyAct: WriteAct | null;
  feedback: ActFeedback | null;
  restoreWarnings: BookingWarning[] | null;
  run: (act: WriteAct) => Promise<void>;
  openChat: (conversationId: string) => void;
};

export function useBookingDetails({
  bookingId,
  onClose,
  onUpdatedInPlace,
}: UseBookingDetailsOptions): BookingDetailsState {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const query = useQuery({
    ...bookingQueries.detail(bookingId ?? ""),
    enabled: bookingId !== null,
  });
  const [busyAct, setBusyAct] = useState<WriteAct | null>(null);
  const [feedback, setFeedback] = useState<ActFeedback | null>(null);
  const [restoreWarnings, setRestoreWarnings] = useState<
    BookingWarning[] | null
  >(null);
  // Closing or opening another Booking clears what the last one said.
  const [shownId, setShownId] = useState(bookingId);
  if (shownId !== bookingId) {
    setShownId(bookingId);
    setFeedback(null);
    setRestoreWarnings(null);
  }
  // An act settles after the Office may have closed the details; this says
  // whether its Booking is still the one on screen.
  const openIdRef = useRef(bookingId);
  useEffect(() => {
    openIdRef.current = bookingId;
  }, [bookingId]);

  // Shows a write's answer at once, so a second act before the refetch
  // lands sends the new `updated_at` rather than a stale one.
  function seed(bookingId: string, change: Partial<BookingDetail>): void {
    queryClient.setQueryData(
      bookingQueries.detail(bookingId).queryKey,
      (old) => old && { ...old, ...change },
    );
  }

  function refresh(): Promise<unknown> {
    return invalidateBookingData(queryClient);
  }

  function openChat(conversationId: string): void {
    if (openIdRef.current !== null) onClose();
    navigate(`/chats/${conversationId}`);
  }

  function offerUndo(reverse: () => Promise<unknown>): () => void {
    return () => {
      reverse()
        .catch(() => showToast({ tone: "error", message: UNDO_FAILED }))
        .finally(() => void refresh());
    };
  }

  function getTellAction(booking: BookingDetail): Partial<ToastInput> {
    const { conversationId } = getGuardianToTell(booking);
    if (conversationId === null) return {};
    return {
      actionLabel: "Open chat",
      onAction: () => openChat(conversationId),
    };
  }

  async function mark(
    booking: BookingDetail,
    status: BookingStatus,
    words: string,
  ): Promise<Outcome> {
    const changed = await updateBookingStatus(booking.id, status, {
      expected_updated_at: booking.updated_at,
    });
    return {
      isClosing: true,
      toast: {
        tone: "success",
        message: `Marked ${words}: ${booking.child.name}, ${describeBookingTime(booking)}.`,
        actionLabel: "Undo",
        onAction: offerUndo(() =>
          updateBookingStatus(booking.id, "confirmed", {
            expected_updated_at: changed.updated_at,
          }),
        ),
      },
    };
  }

  async function write(act: WriteAct, booking: BookingDetail): Promise<Outcome> {
    const guardian = getGuardianToTell(booking).name;
    let outcome: Outcome;
    if (act === "complete") {
      outcome = await mark(booking, "completed", "Completed");
    } else if (act === "didnt_happen") {
      outcome = await mark(booking, "didnt_happen", "Didn’t happen");
    } else if (act === "keep") {
      await acknowledgeClash(booking.id);
      outcome = {
        isClosing: true,
        toast: {
          tone: "success",
          message: `Kept over Time off: ${booking.child.name}, ${describeBookingTime(booking)}.`,
          actionLabel: "Undo",
          onAction: offerUndo(() => clearClashAcknowledgement(booking.id)),
        },
      };
    } else if (act === "stop_keeping") {
      seed(booking.id, await clearClashAcknowledgement(booking.id));
      outcome = {
        isClosing: false,
        toast: {
          tone: "success",
          message: "No longer kept. The Time off clash needs attention again.",
        },
      };
    } else if (act === "reopen") {
      const changed = await updateBookingStatus(booking.id, "confirmed", {
        expected_updated_at: booking.updated_at,
      });
      seed(booking.id, {
        status: changed.status,
        updated_at: changed.updated_at,
      });
      outcome = {
        isClosing: false,
        toast: {
          tone: "success",
          message: `Re-opened: ${booking.child.name}, ${describeBookingTime(booking)}.`,
          actionLabel: "Undo",
          onAction: offerUndo(() =>
            updateBookingStatus(booking.id, booking.status, {
              expected_updated_at: changed.updated_at,
            }),
          ),
        },
      };
    } else if (act === "restore") {
      const changed = await updateBookingStatus(booking.id, "confirmed", {
        expected_updated_at: booking.updated_at,
        confirm_warnings: (restoreWarnings ?? []).map((warning) => warning.code),
      });
      seed(booking.id, {
        status: changed.status,
        updated_at: changed.updated_at,
      });
      outcome = {
        isClosing: false,
        toast: {
          tone: "success",
          message: `Booking restored. Let ${guardian} know.`,
          ...getTellAction(booking),
        },
      };
    } else {
      await updateBookingStatus(booking.id, "cancelled", {
        expected_updated_at: booking.updated_at,
      });
      outcome = {
        isClosing: true,
        toast: {
          tone: "success",
          message: `Booking cancelled. Let ${guardian} know.`,
          ...getTellAction(booking),
        },
      };
    }
    return outcome;
  }

  // What the alert line says about a failed act, or null when the restore
  // came back with warnings to confirm instead.
  function describeFailure(
    act: WriteAct,
    booking: BookingDetail,
    error: unknown,
  ): ActFeedback | null {
    const conflict = conflictOf(error);
    let result: ActFeedback | null = { tone: "danger", message: ACT_FAILED[act] };
    if (conflict?.kind === "stale") {
      result = { tone: "warning", message: STALE_MESSAGE };
    } else if (act === "restore" && conflict?.kind === "warnings") {
      setRestoreWarnings(conflict.warnings);
      result = null;
    } else if (act === "restore" && errorStatus(error) !== null) {
      // A refusal won't change on a resend, so "Restore anyway" goes too.
      setRestoreWarnings(null);
      const message = describeRestoreRefusal(
        { isOverlap: conflict?.kind === "overlap", detail: errorDetail(error) },
        booking,
      );
      result = { tone: "danger", message };
    }
    return result;
  }

  async function run(act: WriteAct): Promise<void> {
    const booking = query.data;
    if (!booking || busyAct !== null) return;

    setBusyAct(act);
    setFeedback(null);
    try {
      const outcome = await write(act, booking);
      setRestoreWarnings(null);
      void refresh();
      if (outcome.isClosing && openIdRef.current === booking.id) onClose();
      if (!outcome.isClosing) onUpdatedInPlace();
      showToast(outcome.toast);
    } catch (error) {
      // A stale row reloads whether or not the details are still open.
      if (conflictOf(error)?.kind === "stale") void refresh();
      if (openIdRef.current === booking.id) {
        setFeedback(describeFailure(act, booking, error));
      } else {
        showToast({ tone: "error", message: getClosedFailure(act, booking) });
      }
    } finally {
      setBusyAct(null);
    }
  }

  return {
    booking: query.data ?? null,
    isLoading: query.isPending && bookingId !== null,
    isNotFound: errorStatus(query.error) === NOT_FOUND,
    isLoadError: query.isError,
    isRetrying: query.isFetching && query.isError,
    retry: () => void query.refetch(),
    busyAct,
    feedback,
    restoreWarnings,
    run,
    openChat,
  };
}
