// Seconds left from a starting value, ticking once a second down to 0.
// Drives the link check's rate-limit wait from the 429's Retry-After.
import { useEffect, useState } from "react";
import { pluralize } from "@/components/kit/format";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

// A new `resetKey` (a fresh answer from the server) restarts the count from `startSeconds`.
export function useCountdown(startSeconds: number, resetKey: unknown): number {
  const [count, setCount] = useState({ resetKey, secondsLeft: startSeconds });
  if (count.resetKey !== resetKey) {
    setCount({ resetKey, secondsLeft: startSeconds });
  }
  const secondsLeft =
    count.resetKey === resetKey ? count.secondsLeft : startSeconds;
  const isCounting = secondsLeft > 0;

  useEffect(() => {
    if (!isCounting) return;
    const timer = setInterval(
      () =>
        setCount((current) => ({
          ...current,
          secondsLeft: Math.max(0, current.secondsLeft - 1),
        })),
      MS_PER_SECOND,
    );
    return () => clearInterval(timer);
  }, [isCounting, resetKey]);

  return secondsLeft;
}

// "1 minute" / "N minutes", rounded up so the wait is never understated.
export function formatWait(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(seconds / SECONDS_PER_MINUTE));
  return pluralize(minutes, "minute", "minutes");
}
