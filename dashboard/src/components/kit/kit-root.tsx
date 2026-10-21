// The kit's root: tokens and the size container every responsive
// class queries (`@5xl:` = 1024px wide). The root is a fixed-height box
// that clips and is never a scroll container itself (`overflow: clip`, not
// `hidden`), so `scrollIntoView` or focus on an element that escapes to it
// can't shift the whole shell; the inner `[data-kit-scroll]` is the one
// box that scrolls the page. `contain: layout` makes it the containing
// block for `fixed` overlays, so they pin to it: to the window on a real
// screen, and to the frame when the prototype fakes a phone. Overlays
// portal to a host beside the scroll area, so the page can go inert
// under them while they still pin here.
import { useLayoutEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getTokenStyle } from "@/components/kit/tokens";
import type { Theme } from "@/components/kit/tokens";
import ToastProvider from "@/components/kit/overlays/toast-provider";
import DeferredActionProvider from "@/components/kit/overlays/deferred-action";
import {
  createOverlayStack,
  OverlayHostContext,
} from "@/components/kit/overlays/overlay-stack";
import "./kit.css";

type KitRootProps = {
  theme: Theme;
  height?: string;
  children: ReactNode;
};

export default function KitRoot({
  theme,
  height = "100dvh",
  children,
}: KitRootProps): ReactNode {
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const [scrollArea, setScrollArea] = useState<HTMLDivElement | null>(null);
  const [stack] = useState(createOverlayStack);
  // A layout effect, so the stack has the page before any overlay opens.
  useLayoutEffect(() => {
    stack.setScrollArea(scrollArea);
  }, [stack, scrollArea]);
  const overlayHost = useMemo(
    () => ({ element: hostElement, stack }),
    [hostElement, stack],
  );
  // --kit-h lets sticky panels (the sidebar) size to the visible height.
  const style = {
    ...getTokenStyle(theme),
    "--kit-h": height,
    height,
    colorScheme: theme,
  } as CSSProperties;
  return (
    <div
      data-kit
      data-theme={theme}
      style={style}
      className="@container relative overflow-clip text-[15px] leading-6 [contain:layout]"
    >
      <OverlayHostContext.Provider value={overlayHost}>
        <ToastProvider>
          <DeferredActionProvider>
            <div
              ref={setScrollArea}
              data-kit-scroll
              className="h-full overflow-y-auto"
            >
              {children}
            </div>
            <div ref={setHostElement} data-kit-overlays className="contents" />
          </DeferredActionProvider>
        </ToastProvider>
      </OverlayHostContext.Provider>
    </div>
  );
}
