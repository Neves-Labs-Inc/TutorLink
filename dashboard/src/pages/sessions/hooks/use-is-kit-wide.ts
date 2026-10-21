import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import { isKitWide } from "@/components/kit/overlays/use-enter-animation";

// Whether the kit root is 672px or wider, for props CSS can't switch
// (the SegmentedControl's full width), measured like the kit overlays.
export function useIsKitWide(ref: RefObject<HTMLElement | null>): boolean {
  const [isWide, setIsWide] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = (): void => setIsWide(isKitWide(element));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element.closest("[data-kit]") ?? document.body);
    return () => observer.disconnect();
  }, [ref]);

  return isWide;
}
