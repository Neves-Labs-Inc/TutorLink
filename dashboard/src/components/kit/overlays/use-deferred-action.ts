// Reversible acts (DESIGN.md §11.6): the UI changes at once, a success
// toast offers Undo, and the API call goes out only when the window ends.
// If the page hides or unloads first, the act is sent at once with fetch
// `keepalive`, so it isn't lost.
//
// Focus rules for consumers:
// - The toast never takes focus (it is polite).
// - When the act removes its own trigger, move focus to the next logical
//   control BEFORE calling `defer`. Never leave focus on <body>.
// - In `onUndo`, put focus back on the restored trigger if it is still on
//   screen; otherwise leave focus alone.
import { createContext, useContext } from "react";
import { TOAST_WITH_ACTION_MS } from "@/components/kit/overlays/toast-provider";

// Tied to the action toast's lifetime, so the Undo button and the send
// can't drift apart.
export const UNDO_WINDOW_MS = TOAST_WITH_ACTION_MS;

export type DeferredActionInput = {
  /**
   * Success toast text: what happened, then what's next, in full
   * sentences with full stops and curly apostrophes. Never mention Undo;
   * the action names it. "Handed back. The bot is answering Diana."
   */
  message: string;
  /** Sends the act. Pass `keepalive` on to the request (`getKeepaliveConfig`). */
  commit: (options: { keepalive: boolean }) => Promise<unknown>;
  /**
   * Restores the optimistic UI. Put focus back on the restored trigger if
   * it is still on screen; otherwise leave focus alone. No toast follows:
   * the restore is the feedback.
   */
  onUndo: () => void;
  /** Runs after a successful commit, e.g. to invalidate queries. */
  onCommitted?: () => void;
  /**
   * Error toast text if the commit rejects: "Couldn’t {act} {object}. Try
   * again." e.g. "Couldn’t hand back the chat with Diana. Try again."
   */
  errorMessage: string;
  /** Runs after a failed commit, e.g. to refetch. */
  onError?: (error: unknown) => void;
};

export type DeferredActionApi = {
  defer: (input: DeferredActionInput) => void;
};

export const DeferredActionContext = createContext<DeferredActionApi | null>(
  null,
);

// Defers a reversible act from anywhere under <KitRoot>.
export function useDeferredAction(): DeferredActionApi {
  const api = useContext(DeferredActionContext);
  if (!api) throw new Error("useDeferredAction needs a <KitRoot> above it");
  return api;
}

// Every mounted provider's flush, so code outside the React tree (sign
// out) can send pending acts while the token is still there.
const flushers = new Set<() => void>();

export function registerDeferredActionFlush(flush: () => void): () => void {
  flushers.add(flush);
  return () => {
    flushers.delete(flush);
  };
}

// Sends every pending act now, with keepalive. Sign out calls this before
// it clears the session, so no act goes out without a token.
export function flushDeferredActions(): void {
  for (const flush of flushers) flush();
}
