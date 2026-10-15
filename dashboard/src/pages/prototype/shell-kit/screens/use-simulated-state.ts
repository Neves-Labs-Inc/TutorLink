// Fakes a fetch lifecycle for the lists and states screens. Retry goes
// through loading and lands on ready.
import { useState } from "react";

export type DataState = "ready" | "loading" | "error" | "empty";

export const DATA_STATE_ITEMS = [
  { id: "ready", label: "Loaded" },
  { id: "loading", label: "Loading" },
  { id: "error", label: "Error" },
  { id: "empty", label: "Empty" },
];

const FAKE_LOAD_MS = 1400;

type SimulatedState = {
  state: DataState;
  isRetrying: boolean;
  setState: (state: DataState) => void;
  retry: () => void;
};

export function useSimulatedState(): SimulatedState {
  const [state, setState] = useState<DataState>("ready");
  const [isRetrying, setIsRetrying] = useState(false);

  function retry(): void {
    setIsRetrying(true);
    window.setTimeout(() => {
      setIsRetrying(false);
      setState("loading");
      window.setTimeout(() => setState("ready"), FAKE_LOAD_MS);
    }, FAKE_LOAD_MS / 2);
  }

  return { state, isRetrying, setState, retry };
}
