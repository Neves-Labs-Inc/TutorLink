// Holds every pending reversible act (see use-deferred-action.ts). It
// sits under KitRoot's ToastProvider, so pending acts outlive route
// changes, and it renders only its children.
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import {
  DeferredActionContext,
  registerDeferredActionFlush,
  UNDO_WINDOW_MS,
} from "@/components/kit/overlays/use-deferred-action";
import type { DeferredActionInput } from "@/components/kit/overlays/use-deferred-action";
import { useToast } from "@/components/kit/overlays/use-toast";
import { useAuthStore } from "@/stores/authStore";

const LATE_UNDO_MESSAGE = "Already done. It can’t be undone now.";

// Commits run from timers and page events, so nothing awaits them: a
// throwing consumer callback would become an unhandled rejection.
function runConsumerCallback(callback: () => void): void {
  try {
    callback();
  } catch (error) {
    console.error("Deferred action callback failed", error);
  }
}

type PendingAct = { input: DeferredActionInput; timer: number };

type DeferredActionProviderProps = { children: ReactNode };

export default function DeferredActionProvider({
  children,
}: DeferredActionProviderProps): ReactNode {
  const { showToast } = useToast();
  const nextId = useRef(1);
  const pendingRef = useRef(new Map<number, PendingAct>());
  // Acts already sent, so a late Undo can say so instead of doing nothing.
  const committedRef = useRef(new Set<number>());

  // Sends one act at most once. The commit starts synchronously, which a
  // keepalive request fired from `pagehide` needs.
  const commit = useCallback(
    async (id: number, keepalive: boolean): Promise<void> => {
      const act = pendingRef.current.get(id);
      if (!act) return;

      window.clearTimeout(act.timer);
      pendingRef.current.delete(id);
      committedRef.current.add(id);
      let isCommitted = true;
      try {
        await act.input.commit({ keepalive });
      } catch (error) {
        isCommitted = false;
        // Nothing was done, so a late Undo mustn't say "Already done".
        committedRef.current.delete(id);
        showToast({ tone: "error", message: act.input.errorMessage });
        runConsumerCallback(() => act.input.onError?.(error));
      }
      if (isCommitted) runConsumerCallback(() => act.input.onCommitted?.());
    },
    [showToast],
  );

  const undo = useCallback(
    (id: number): void => {
      const act = pendingRef.current.get(id);
      if (act) {
        window.clearTimeout(act.timer);
        pendingRef.current.delete(id);
        act.input.onUndo();
      } else if (committedRef.current.has(id)) {
        showToast({ tone: "info", message: LATE_UNDO_MESSAGE });
      }
    },
    [showToast],
  );

  const defer = useCallback(
    (input: DeferredActionInput): void => {
      const id = nextId.current;
      nextId.current += 1;
      // The kit keeps 3 live toasts, so a 4th evicts the oldest. The
      // evicted act still commits on its own timer; only its Undo is gone.
      showToast({
        tone: "success",
        message: input.message,
        actionLabel: "Undo",
        onAction: () => undo(id),
      });
      const timer = window.setTimeout(
        () => void commit(id, false),
        UNDO_WINDOW_MS,
      );
      pendingRef.current.set(id, { input, timer });
    },
    [showToast, undo, commit],
  );

  // Hiding or unloading the page sends every pending act now, with
  // keepalive, so it survives the page going away. Sign out triggers the
  // same flush through the registry; unmounting does too while signed in.
  useEffect(() => {
    const pending = pendingRef.current;
    function flush(): void {
      for (const id of [...pending.keys()]) {
        void commit(id, true);
      }
    }
    function handleVisibilityChange(): void {
      if (document.visibilityState === "hidden") flush();
    }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const unregister = registerDeferredActionFlush(flush);
    return () => {
      unregister();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // Sign out flushes first (flushDeferredActions), then clears the
      // token before this unmounts. An act left pending by then would go
      // out anonymously and 401 into a refresh that can sign the person
      // back in if the logout call failed, so it is dropped instead.
      if (useAuthStore.getState().accessToken !== null) {
        flush();
      } else {
        pending.forEach((act) => window.clearTimeout(act.timer));
        pending.clear();
      }
    };
  }, [commit]);

  const api = useMemo(() => ({ defer }), [defer]);

  return (
    <DeferredActionContext.Provider value={api}>
      {children}
    </DeferredActionContext.Provider>
  );
}

// Named too: the ticket's interface names it, and kit components default-export.
export { DeferredActionProvider };
