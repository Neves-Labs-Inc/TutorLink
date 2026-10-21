// Takes a pending footer focus request (see footer-focus-store) once its
// target is on screen and focusable.
import { useEffect } from "react";
import type { RefObject } from "react";
import { isFocusRequestLive } from "@/lib/chatThread";
import { useFooterFocusStore } from "@/stores/footer-focus-store";

// The first control of a footer the bot holds, or of a closed window.
export const FIRST_CONTROL_TARGETS = ["[data-takeover]", "[data-copy-number]"];
// The composer, or Hand back when the window has closed.
export const COMPOSER_TARGETS = ["[data-composer]", "[data-hand-back]"];

export function useFooterFocus(
  rootRef: RefObject<HTMLElement | null>,
  conversationId: string,
): void {
  const request = useFooterFocusStore((state) =>
    state.conversationId === conversationId ? state.request : null,
  );

  // Every render: the target may mount a render later, and a closing
  // dialog keeps the page inert until its own cleanup has run.
  useEffect(() => {
    if (request === null) return;
    const { clear } = useFooterFocusStore.getState();
    if (!isFocusRequestLive(request, Date.now())) {
      clear();
      return;
    }
    const target = request.targets
      .map((selector) => rootRef.current?.querySelector<HTMLElement>(selector))
      .find((element) => element !== null && element !== undefined);
    target?.focus();
    if (target !== undefined && document.activeElement === target) clear();
  });
}
