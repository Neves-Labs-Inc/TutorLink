// A form's submit phase against the mock API. A submit always succeeds
// after the mock latency; the failure states are shown by the switcher's
// state instead, so each one can be looked at directly.
import { useState } from "react";
import { waitForMockLatency } from "@/pages/prototype/auth/lib/mock-auth-api";

type MockSubmit = {
  isSubmitting: boolean;
  submit: () => Promise<void>;
};

export function useMockSubmit(
  isStartedSubmitting: boolean,
  onSuccess: () => void,
): MockSubmit {
  const [isSubmitting, setIsSubmitting] = useState(isStartedSubmitting);

  async function submit(): Promise<void> {
    setIsSubmitting(true);
    await waitForMockLatency();
    onSuccess();
  }

  return { isSubmitting, submit };
}
