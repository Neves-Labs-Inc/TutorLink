// Seconds left from a starting value, ticking once a second to 0. Drives
// the sign-in lockout from the 429's Retry-After.
import { useEffect, useState } from "react";

const TICK_MS = 1000;

export function useCountdown(startSeconds: number): number {
  const [secondsLeft, setSecondsLeft] = useState(startSeconds);
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((left) => left - 1), TICK_MS);
    return () => clearTimeout(timer);
  }, [secondsLeft]);
  return secondsLeft;
}

export function formatWait(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "about a minute" : `${minutes} minutes`;
}
