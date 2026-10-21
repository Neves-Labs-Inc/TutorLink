// Focus the first field of a sheet's form when it opens. The kit panel
// grabs focus itself on open, so this takes it back a frame later.
import { useCallback, useEffect, useRef } from "react";

const FIRST_FIELD = "input, textarea";

export function useFirstFieldFocus(
  isOpen: boolean,
): (form: HTMLFormElement | null) => void {
  const formRef = useRef<HTMLFormElement | null>(null);

  const focusField = useCallback(() => {
    const field = formRef.current?.querySelector<HTMLElement>(FIRST_FIELD);
    if (!field) return;
    requestAnimationFrame(() => field.focus());
  }, []);

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
