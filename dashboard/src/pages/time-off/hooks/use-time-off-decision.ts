// Approve and Decline as reversible acts (DESIGN.md §11.6): the caches
// change at once, the PATCH waits behind the Undo toast, and Undo puts
// the previous row back.
import type { RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDeferredAction } from "@/components/kit/overlays/use-deferred-action";
import {
  invalidateAfterTimeOffWrite,
  replaceCachedTimeOff,
  sendTimeOffDecision,
  TIME_OFF_KEY,
} from "@/lib/queries/time-off";
import type { ExceptionRead, TimeOffDecision } from "@/lib/queries/time-off";
import { getDecisionCopy } from "@/pages/time-off/lib/time-off-copy";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";
import { useTimeOffDecisionStore } from "@/stores/time-off-decision-store";

export type TimeOffDecisionActs = {
  isQueued: boolean;
  decide: (decision: TimeOffDecision) => void;
};

export function useTimeOffDecision(
  item: ExceptionRead | null,
  viewer: Viewer,
  wellRef: RefObject<HTMLElement | null>,
): TimeOffDecisionActs {
  const client = useQueryClient();
  const { defer } = useDeferredAction();
  const isQueued = useTimeOffDecisionStore((state) =>
    item ? state.queuedIds.has(item.id) : false,
  );
  const { queue, release } = useTimeOffDecisionStore.getState();

  function decide(decision: TimeOffDecision): void {
    if (!item) return;

    const previous = item;
    // A fetch already in flight would land the old status over the new one.
    void client.cancelQueries({ queryKey: TIME_OFF_KEY });
    replaceCachedTimeOff(client, {
      ...previous,
      status: decision,
      // The status sentence names the viewer by id ("you"), not by name.
      decided_by: { id: viewer.id, name: "" },
      decided_at: new Date().toISOString(),
    });
    queue(previous.id);
    // The pressed button is about to unmount; the well reads the result.
    wellRef.current?.focus();

    const settle = () => {
      release(previous.id);
      void invalidateAfterTimeOffWrite(client);
    };
    defer({
      ...getDecisionCopy(previous, decision),
      commit: ({ keepalive }) =>
        sendTimeOffDecision(previous.id, decision, keepalive),
      onUndo: () => {
        replaceCachedTimeOff(client, previous);
        release(previous.id);
      },
      onCommitted: settle,
      // A refusal (e.g. someone decided first) refetches the true state.
      onError: settle,
    });
  }

  return { isQueued, decide };
}
