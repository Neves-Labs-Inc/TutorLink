// One Time off for the details overlay: its read state, and Cancel with
// its confirm, failure line and focus hand-off.
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorStatus } from "@/lib/api";
import { timeOffMutations, timeOffQueries } from "@/lib/queries/time-off";
import type { ExceptionRead } from "@/lib/queries/time-off";
import { getFirstName } from "@/pages/time-off/lib/time-off-copy";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";

const NOT_READABLE = new Set([403, 404]);
const HTTP_CONFLICT = 409;
const CHANGED_MESSAGE = "This time off changed. Check its status and try again.";
const FAILED_MESSAGE = "Couldn’t cancel it. Check your connection and try again.";

export type TimeOffReadState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "error"; isRetrying: boolean; onRetry: () => void }
  | { kind: "ready"; item: ExceptionRead };

export type TimeOffDetails = {
  read: TimeOffReadState;
  isConfirmingCancel: boolean;
  isCancelling: boolean;
  actError: string | null;
  wellRef: RefObject<HTMLParagraphElement | null>;
  openCancel: () => void;
  closeCancel: () => void;
  confirmCancel: () => void;
};

export function useTimeOffDetails(id: string | null, viewer: Viewer): TimeOffDetails {
  const query = useQuery({
    ...timeOffQueries.detail(id ?? ""),
    enabled: id !== null,
  });
  const cancel = useMutation(timeOffMutations.cancel());
  const { showToast } = useToast();
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [shownId, setShownId] = useState(id);
  const [wellFocusRequest, setWellFocusRequest] = useState(0);
  const wellRef = useRef<HTMLParagraphElement>(null);

  // A failure belongs to one viewing: closing or opening another Time off
  // clears it (state adjusted during render, not in an effect).
  if (id !== shownId) {
    setShownId(id);
    setActError(null);
    setIsConfirmingCancel(false);
  }

  // Runs after the dialog's own cleanup has handed focus back to the
  // Cancel button, which the act has just removed.
  useEffect(() => {
    if (wellFocusRequest > 0) wellRef.current?.focus();
  }, [wellFocusRequest]);

  let read: TimeOffReadState = { kind: "loading" };
  if (query.data) {
    read = { kind: "ready", item: query.data };
  } else if (query.isError && NOT_READABLE.has(errorStatus(query.error) ?? 0)) {
    read = { kind: "not-found" };
  } else if (query.isError) {
    read = {
      kind: "error",
      isRetrying: query.isFetching,
      onRetry: () => void query.refetch(),
    };
  }

  function openCancel(): void {
    setActError(null);
    setIsConfirmingCancel(true);
  }

  function confirmCancel(): void {
    const item = query.data;
    if (!item) return;

    const isOwn = item.staff.id === viewer.id;
    cancel.mutate(item.id, {
      onSuccess: () => {
        setIsConfirmingCancel(false);
        setWellFocusRequest((count) => count + 1);
        showToast({
          tone: "success",
          message: isOwn
            ? "Cancelled your time off."
            : `Cancelled ${getFirstName(item.staff.name)}’s time off.`,
        });
      },
      // A 409 means it was decided, ended or cancelled meanwhile; the
      // write's invalidation refetches it.
      onError: (error) => {
        setIsConfirmingCancel(false);
        setActError(
          errorStatus(error) === HTTP_CONFLICT ? CHANGED_MESSAGE : FAILED_MESSAGE,
        );
      },
    });
  }

  return {
    read,
    isConfirmingCancel,
    isCancelling: cancel.isPending,
    actError,
    wellRef,
    openCancel,
    closeCancel: () => setIsConfirmingCancel(false),
    confirmCancel,
  };
}
