// Office phone: takes the "+1 (305) 555-0142" shape as it's typed, keeps
// the caret after the digit it was after, and hands the form E.164.
import { useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Phone } from "lucide-react";
import { FieldFrame } from "@/components/kit/components/settings-form";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { cn } from "@/components/kit/tokens";
import { formatPhoneInput, toE164 } from "@/lib/settings/office-phone";
import type { BoundField } from "@/pages/settings/hooks/use-settings-form";

type OfficePhoneFieldProps = { field: BoundField; onBlur: () => void };

function formatStored(e164: string): string {
  return formatPhoneInput(e164, 0).text;
}

export default function OfficePhoneField({
  field,
  onBlur,
}: OfficePhoneFieldProps): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef<number | null>(null);
  const [typed, setTyped] = useState(() => formatStored(field.value));
  // What they typed, unless the value changed from outside (Discard).
  const shown =
    toE164(typed) === field.value ? typed : formatStored(field.value);

  // After React writes the new text, put the caret back where it belongs.
  useLayoutEffect(() => {
    const caret = caretRef.current;
    if (caret === null || !inputRef.current) return;
    inputRef.current.setSelectionRange(caret, caret);
    caretRef.current = null;
  });

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    const { value, selectionStart } = event.target;
    const next = formatPhoneInput(value, selectionStart ?? value.length);
    caretRef.current = next.caret;
    setTyped(next.text);
    field.onChange(toE164(next.text));
  }

  return (
    <FieldFrame
      label="Office phone"
      help="Tutors see this as the number to call the office. Leave it empty to hide it."
      error={field.error}
      isChanged={field.isChanged}
    >
      {({ controlId, describedBy }) => (
        <div className="relative max-w-[320px]">
          <Phone
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-(--tl-muted)"
          />
          <input
            ref={inputRef}
            id={controlId}
            type="tel"
            autoComplete="off"
            placeholder="+1 305 555 0142"
            value={shown}
            aria-describedby={describedBy}
            aria-invalid={field.error ? true : undefined}
            onChange={handleChange}
            onBlur={onBlur}
            className={cn(
              getControlClasses(Boolean(field.error)),
              "h-11 rounded-full pr-4 pl-11",
            )}
          />
        </div>
      )}
    </FieldFrame>
  );
}
