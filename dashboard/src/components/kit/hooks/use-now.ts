import { useEffect, useState } from "react";

const DEFAULT_INTERVAL_MS = 60_000;

// The current time in ms, refreshed on a beat so countdowns stay true.
export function useNow(intervalMs: number = DEFAULT_INTERVAL_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
