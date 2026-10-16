// Width and scale hooks for DeviceFrame (390×844 phone, framed from 640px).
import { useEffect, useState } from "react";

export const PHONE_WIDTH = 390;
export const PHONE_HEIGHT = 844;
// Below this the window is already phone-sized, so no frame.
const FRAME_MIN_WIDTH = 640;
// Room around the frame: a margin on top, the switcher below.
const FRAME_CHROME_PX = 96;

export function useIsWide(): boolean {
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

// Shrinks the phone frame to fit short windows (laptops) without
// changing its 390px layout width.
export function useFrameScale(): number {
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
