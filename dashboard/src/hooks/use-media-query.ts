import { useSyncExternalStore } from "react";

// True while the CSS media query matches; re-renders when it flips.
export function useMediaQuery(query: string): boolean {
  function subscribe(onChange: () => void): () => void {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }

  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}
