// The live width of one element, so a layout can switch on the space it
// actually has (the phone frame, a narrow window) rather than the screen.
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export function useElementWidth<T extends HTMLElement>(): [
  RefObject<T | null>,
  number,
] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
