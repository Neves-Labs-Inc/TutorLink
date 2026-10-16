// Modal focus handling shared by every overlay: focus moves in on open,
// Tab cycles inside, Escape closes, and focus returns to the opener.
// Under a KitRoot the overlay joins its stack, so only the top overlay
// takes keys and everything below it is inert.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useOverlayHost } from "@/components/kit/overlays/overlay-stack";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusables(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null,
  );
}

// Wraps Tab at the panel's edges, and pulls focus back in when it has
// strayed outside (a click on the scrim leaves it on the body).
function trapTab(event: KeyboardEvent, panel: HTMLElement): void {
  const focusables = getFocusables(panel);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const isOutside = !panel.contains(active);
  if (event.shiftKey && (isOutside || active === first)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (isOutside || active === last)) {
    event.preventDefault();
    first.focus();
  }
}

export function useDialogFocus(
  panelRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onClose: () => void,
): void {
  const host = useOverlayHost();
  const stack = host?.stack ?? null;
  // The panel only exists once KitRoot's host has mounted.
  const hostElement = host?.element ?? null;
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    stack?.open(panel);
    panel.focus();

    function isActive(event: KeyboardEvent): boolean {
      if (!panel) return false;
      // Outside a KitRoot there is no stack: answer keys from inside only.
      if (!stack) return panel.contains(event.target as Node);
      return stack.isTop(panel);
    }

    function handleKeyDown(event: KeyboardEvent): void {
      // Once one layer (or a popover inside it) has handled the key, no
      // other layer acts on it: one Escape closes one overlay.
      if (event.defaultPrevented || !panel || !isActive(event)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab") trapTab(event, panel);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Leave the stack first so the opener is no longer inert.
      stack?.close(panel);
      opener?.focus();
    };
  }, [isOpen, panelRef, stack, hostElement]);
}
