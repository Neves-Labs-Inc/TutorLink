// Renders an overlay at the KitRoot level, outside the page content, so
// the page can go inert while the overlay still pins to KitRoot (and so
// to the phone frame). Not a native <dialog>: its top layer would escape
// the frame.
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useOverlayHost } from "@/pages/prototype/shell-kit/kit/overlays/overlay-stack";

type OverlayLayerProps = { children: ReactNode };

export function OverlayLayer({ children }: OverlayLayerProps): ReactNode {
  const host = useOverlayHost();
  if (!host) return children;
  // Wait for the host rather than render in place first: moving the
  // overlay later would remount it and lose the opener to return focus to.
  if (!host.element) return null;

  return createPortal(
    <div data-kit-overlay className="contents">
      {children}
    </div>,
    host.element,
  );
}
