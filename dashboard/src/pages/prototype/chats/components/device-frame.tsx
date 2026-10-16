// The phone frame from the shell-kit prototype (copied: it lives in
// shell-kit-prototype.tsx, not in kit/). ?device=phone on a wide window
// draws the page at 390×844 inside a frame; a narrow window needs none.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import KitRoot from "@/pages/prototype/shell-kit/kit/kit-root";
import type { Theme } from "@/pages/prototype/shell-kit/kit/tokens";

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
const FRAME_MIN_WIDTH = 640;
const FRAME_CHROME_PX = 96;

function useIsWide(): boolean {
  const query = `(min-width: ${FRAME_MIN_WIDTH}px)`;
  const [isWide, setIsWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = (): void => setIsWide(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [query]);
  return isWide;
}

function useFrameScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    function handleResize(): void {
      setScale(Math.min(1, (window.innerHeight - FRAME_CHROME_PX) / PHONE_HEIGHT));
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return scale;
}

type DeviceFrameProps = {
  theme: Theme;
  isPhone: boolean;
  children: ReactNode;
};

export default function DeviceFrame({
  theme,
  isPhone,
  children,
}: DeviceFrameProps): ReactNode {
  const isWide = useIsWide();
  const scale = useFrameScale();
  if (!isPhone || !isWide) return <KitRoot theme={theme}>{children}</KitRoot>;

  return (
    <div className="flex h-dvh items-start justify-center overflow-hidden bg-neutral-300 pt-4">
      <div
        className="shrink-0 origin-top overflow-hidden rounded-[44px] shadow-2xl ring-[10px] ring-neutral-800"
        style={{
          width: PHONE_WIDTH,
          height: PHONE_HEIGHT,
          transform: scale < 1 ? `scale(${scale})` : undefined,
        }}
      >
        <KitRoot theme={theme} height={`${PHONE_HEIGHT}px`}>
          {children}
        </KitRoot>
      </div>
    </div>
  );
}
