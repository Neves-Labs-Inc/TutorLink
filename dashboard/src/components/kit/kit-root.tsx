// The kit's root: tokens, fonts, and the size container every responsive
// class queries (`@5xl:` = 1024px wide). The root is a fixed-height box
// that scrolls inside, and `contain: layout` makes it the containing
// block for `fixed` overlays, so they pin to it: to the window on a real
// screen, and to the frame when the prototype fakes a phone. Overlays
// portal to a host beside the scroll area, so the page can go inert
// under them while they still pin here.
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getTokenStyle } from "@/components/kit/tokens";
import type { Theme } from "@/components/kit/tokens";
import ToastProvider from "@/components/kit/overlays/toast-provider";
import {
  createOverlayStack,
  OverlayHostContext,
} from "@/components/kit/overlays/overlay-stack";
import "./kit.css";

const FONTS_LINK_ID = "kit-fonts";
const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&family=Inter:wght@400..700&display=swap";

function useKitFonts(): void {
  useEffect(() => {
    if (document.getElementById(FONTS_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONTS_LINK_ID;
    link.rel = "stylesheet";
    link.href = FONTS_HREF;
    document.head.appendChild(link);
  }, []);
}

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
  useKitFonts();
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
      className="@container relative overflow-hidden text-[15px] leading-6 [contain:layout]"
    >
      <OverlayHostContext.Provider value={overlayHost}>
        <ToastProvider>
          <div
            ref={setScrollArea}
            data-kit-scroll
            className="h-full overflow-y-auto"
          >
            {children}
          </div>
          <div ref={setHostElement} data-kit-overlays className="contents" />
        </ToastProvider>
      </OverlayHostContext.Provider>
    </div>
  );
}
