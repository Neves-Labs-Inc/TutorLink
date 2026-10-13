// The kit's root: tokens, fonts, and the size container every responsive
// class queries (`@5xl:` = 1024px wide). The root is a fixed-height box
// that scrolls inside, and `contain: layout` makes it the containing
// block for `fixed` overlays, so they pin to it: to the window on a real
// screen, and to the frame when the prototype fakes a phone.
import { useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getTokenStyle } from "@/pages/prototype/shell-kit/kit/tokens";
import type { Theme } from "@/pages/prototype/shell-kit/kit/tokens";
import ToastProvider from "@/pages/prototype/shell-kit/kit/overlays/toast-provider";
import "./kit.css";

const FONTS_LINK_ID = "shell-kit-fonts";
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
      <ToastProvider>
        <div data-kit-scroll className="h-full overflow-y-auto">
          {children}
        </div>
      </ToastProvider>
    </div>
  );
}
