// Whole seconds left in a lockout, ticking once a second to 0. Reads the
// clock rather than counting ticks, so a throttled background tab still
// ends the wait on time.
import { useEffect, useState } from "react";
import type { Lockout } from "@/lib/auth/sign-in";

const TICK_MS = 1000;

export function useCountdown(lockout: Lockout | null): number {
  const [now, setNow] = useState(() => Date.now());
  // `from` is when the lockout began; it beats a clock last read before then.
  const secondsLeft =
    lockout === null
      ? 0
      : Math.max(0, Math.ceil((lockout.until - Math.max(now, lockout.from)) / TICK_MS));
  const isRunning = secondsLeft > 0;

  useEffect(() => {
    if (!isRunning) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [isRunning]);

  return secondsLeft;
}
