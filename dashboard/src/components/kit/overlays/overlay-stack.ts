// Modality for the kit's overlays. KitRoot owns one stack; every open
// overlay joins it. Only the top overlay is live: the page's scroll area
// and every lower overlay are inert, and the scroll area is locked.
// Toasts sit outside both, so they are never inert. A closed overlay
// may stay mounted while its exit plays; it leaves the stack at once and
// stays inert, so the layer below (or the page) is live during the exit.
import { createContext, useContext } from "react";

export type OverlayStack = {
  // KitRoot's scroll area: the page under the overlays.
  setScrollArea: (element: HTMLElement | null) => void;
  open: (panel: HTMLElement) => void;
  close: (panel: HTMLElement) => void;
  isTop: (panel: HTMLElement) => boolean;
};

export type OverlayHost = {
  // Where overlays portal to: inside KitRoot, outside the page content.
  // Null until KitRoot has mounted it.
  element: HTMLElement | null;
  stack: OverlayStack;
};

export const OverlayHostContext = createContext<OverlayHost | null>(null);

// Null outside a KitRoot; overlays then render in place, as before.
export function useOverlayHost(): OverlayHost | null {
  return useContext(OverlayHostContext);
}

// The overlay's whole layer (scrim included), as OverlayLayer marks it.
function getLayer(panel: HTMLElement): HTMLElement {
  return panel.closest<HTMLElement>("[data-kit-overlay]") ?? panel;
}

// inert blocks focus and pointer; aria-hidden as well, because not every
// assistive tech (or Playwright's role queries) treats inert as hidden.
function setInert(element: HTMLElement, isInert: boolean): void {
  element.inert = isInert;
  if (isInert) {
    element.setAttribute("aria-hidden", "true");
  } else {
    element.removeAttribute("aria-hidden");
  }
}

// Belt and braces with inert: an exiting layer must never catch a click
// meant for what is under it.
function setPassThrough(layer: HTMLElement, isPassThrough: boolean): void {
  layer.style.pointerEvents = isPassThrough ? "none" : "";
}

function lockScroll(scrollArea: HTMLElement): void {
  const hasScrollbar = scrollArea.scrollHeight > scrollArea.clientHeight;
  // overflow:hidden keeps scrollTop, so the page is where it was on unlock.
  scrollArea.style.overflowY = "hidden";
  // Keep the scrollbar's space so the page doesn't shift sideways.
  if (hasScrollbar) scrollArea.style.scrollbarGutter = "stable";
}

function unlockScroll(scrollArea: HTMLElement): void {
  scrollArea.style.overflowY = "";
  scrollArea.style.scrollbarGutter = "";
}

export function createOverlayStack(): OverlayStack {
  // Mutable on purpose: open and close must take effect synchronously, so
  // a closing overlay can hand focus back to a lower one in its cleanup.
  const panels: HTMLElement[] = [];
  let scrollArea: HTMLElement | null = null;

  function sync(wasEmpty: boolean): void {
    const top = panels.at(-1);
    panels.forEach((panel) => {
      setInert(getLayer(panel), panel !== top);
    });
    if (!scrollArea) return;
    const isEmpty = panels.length === 0;
    setInert(scrollArea, !isEmpty);
    if (wasEmpty && !isEmpty) lockScroll(scrollArea);
    if (!wasEmpty && isEmpty) unlockScroll(scrollArea);
  }

  return {
    setScrollArea(element) {
      scrollArea = element;
    },
    open(panel) {
      if (panels.includes(panel)) return;
      const wasEmpty = panels.length === 0;
      panels.push(panel);
      // Reopened mid-exit: the same layer comes back to life.
      setPassThrough(getLayer(panel), false);
      sync(wasEmpty);
    },
    close(panel) {
      const index = panels.indexOf(panel);
      if (index === -1) return;
      panels.splice(index, 1);
      setInert(getLayer(panel), true);
      setPassThrough(getLayer(panel), true);
      sync(false);
    },
    isTop(panel) {
      return panels.at(-1) === panel;
    },
  };
}
