// Holds the page's load state from the switcher; "Try again" on an error
// shows loading briefly, then the data.
import { useEffect, useState } from "react";

export type Load = "ready" | "loading" | "error";

const RETRY_MS = 900;

export function useSimulatedLoad(initial: Load): [Load, () => void] {
  const [load, setLoad] = useState<Load>(initial);
  const [isRetrying, setIsRetrying] = useState(false);

  useEffect(() => {
    if (!isRetrying) return;
    const timer = window.setTimeout(() => {
      setLoad("ready");
      setIsRetrying(false);
    }, RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [isRetrying]);

  function retry(): void {
    setLoad("loading");
    setIsRetrying(true);
  }

  return [load, retry];
}
