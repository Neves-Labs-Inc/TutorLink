import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

// A step on the DESIGN.md §8 width scale (@6xl): list and thread share a row.
export const SPLIT_KIT_WIDTH = 1152;

function measureIsSplit(element: HTMLElement): boolean {
  const root = element.closest("[data-kit]");
  return (root?.clientWidth ?? window.innerWidth) >= SPLIT_KIT_WIDTH;
}

// Which thread container mounts (pane or overlay) can't be chosen in CSS,
// so this reads the kit root width, like isKitWide in the kit overlays.
// It is null until measured (before the first paint), so a deep link on a
// wide screen never mounts a throwaway overlay with its focus and scroll
// lock first.
export function useIsSplit(ref: RefObject<HTMLElement | null>): boolean | null {
  const [isSplit, setIsSplit] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = (): void => setIsSplit(measureIsSplit(element));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element.closest("[data-kit]") ?? document.body);
    return () => observer.disconnect();
  }, [ref]);

  return isSplit;
}
