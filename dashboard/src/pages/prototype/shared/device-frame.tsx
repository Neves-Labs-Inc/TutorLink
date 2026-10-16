// The fake phone for desktop windows: 390×844, framed only from a 640px
// window up (below that the window is already phone-sized). KitRoot sits
// inside, so kit overlays pin to the frame.
import type { ReactNode } from "react";
import {
  PHONE_HEIGHT,
  PHONE_WIDTH,
  useFrameScale,
  useIsWide,
} from "@/pages/prototype/shared/hooks/use-device-frame";
import KitRoot from "@/components/kit/kit-root";
import type { Theme } from "@/components/kit/tokens";

type DeviceFrameProps = {
  theme: Theme;
  isPhone: boolean;
  children: ReactNode;
};

// Not phone, or a window too narrow to frame: a plain KitRoot.
export function DeviceFrame({
  theme,
  isPhone,
  children,
}: DeviceFrameProps): ReactNode {
  const isWide = useIsWide();
  const frameScale = useFrameScale();

  if (!isPhone || !isWide) {
    return <KitRoot theme={theme}>{children}</KitRoot>;
  }
  return (
    <div className="flex h-dvh items-start justify-center overflow-hidden bg-neutral-300 pt-4">
      <div
        className="shrink-0 origin-top overflow-hidden rounded-[44px] shadow-2xl ring-[10px] ring-neutral-800"
        style={{
          width: PHONE_WIDTH,
          height: PHONE_HEIGHT,
          transform: frameScale < 1 ? `scale(${frameScale})` : undefined,
        }}
      >
        <KitRoot theme={theme} height={`${PHONE_HEIGHT}px`}>
          {children}
        </KitRoot>
      </div>
    </div>
  );
}
