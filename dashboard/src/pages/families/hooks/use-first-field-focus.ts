// Focus the first field of a sheet's form when it opens. The kit panel
// grabs focus itself on open, so this takes it back a frame later.
// A form whose fields load later passes `isReady` false until they're
// there; `selector` picks a field other than the first input (a Select
// is a button).
import { useCallback, useEffect, useRef } from "react";

const FIRST_FIELD = "input, textarea";

export function useFirstFieldFocus(
  isOpen: boolean,
  { isReady = true, selector = FIRST_FIELD }: { isReady?: boolean; selector?: string } = {},
): (form: HTMLFormElement | null) => void {
  const formRef = useRef<HTMLFormElement | null>(null);

  const focusField = useCallback(() => {
    if (!isReady) return;
    const field = formRef.current?.querySelector<HTMLElement>(selector);
    if (!field) return;
    requestAnimationFrame(() => field.focus());
  }, [isReady, selector]);

  // Reopening mid-exit keeps the form mounted, so the ref stays quiet.
  useEffect(() => {
    if (isOpen) focusField();
  }, [isOpen, focusField]);

  return useCallback(
    (form: HTMLFormElement | null) => {
      formRef.current = form;
      if (form) focusField();
    },
    [focusField],
  );
}
