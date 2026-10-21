// A labelled group of checkbox rows in a sheet ("Linked to", "Lives at",
// "Whose home"), with an optional hint and its error under the rows.
import { useId } from "react";
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

type CheckGroupProps = {
  legend: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
};

export default function CheckGroup({
  legend,
  hint,
  error = null,
  children,
}: CheckGroupProps): ReactNode {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(" ");

  return (
    <fieldset
      aria-describedby={describedBy || undefined}
      aria-invalid={error ? true : undefined}
      className="flex flex-col gap-1"
    >
      <legend className="mb-1 text-[14px] font-semibold">{legend}</legend>
      {hint && (
        <p id={hintId} className="mb-1 text-[13px] text-(--tl-muted)">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p
          id={errorId}
          className="flex items-start gap-1.5 px-1 text-[13px] leading-[18px] font-medium text-(--tl-danger)"
        >
          <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          {error}
        </p>
      )}
    </fieldset>
  );
}
