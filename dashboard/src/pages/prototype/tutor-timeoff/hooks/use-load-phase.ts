// Drives a page's fetch lifecycle from the switcher's ?state=. Loading
// stays loading so it can be looked at; Try again on an error goes
// through loading and lands on the data.
import { useState } from "react";

export type DataState = "populated" | "loading" | "empty" | "error";
export type Phase = "ready" | "loading" | "error";

const FAKE_LOAD_MS = 1200;

type LoadPhase = { phase: Phase; isRetrying: boolean; retry: () => void };

export function useLoadPhase(state: DataState): LoadPhase {
  const [phase, setPhase] = useState<Phase>(() => {
    if (state === "loading") return "loading";
    return state === "error" ? "error" : "ready";
  });
  const [isRetrying, setIsRetrying] = useState(false);

  function retry(): void {
    setIsRetrying(true);
    window.setTimeout(() => {
      setIsRetrying(false);
      setPhase("loading");
      window.setTimeout(() => setPhase("ready"), FAKE_LOAD_MS);
    }, FAKE_LOAD_MS / 2);
  }

  return { phase, isRetrying, retry };
}
