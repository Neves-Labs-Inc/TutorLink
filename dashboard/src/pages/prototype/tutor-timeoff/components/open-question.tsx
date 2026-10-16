// Prototype-only marker for a placeholder that is still an open
// question: a dashed "?" that shows the question on tap. Same marker as
// the Bookings prototype.
import type { ReactNode } from "react";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";

type OpenQuestionProps = { question: string };

export default function OpenQuestion({ question }: OpenQuestionProps): ReactNode {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      aria-label={`Open question: ${question}`}
      title={question}
      onClick={(event) => {
        // Never opens the row or card it sits in.
        event.stopPropagation();
        showToast({ tone: "info", message: `Open question: ${question}` });
      }}
      className="-m-2 inline-flex size-11 shrink-0 cursor-help items-center justify-center rounded-full align-middle"
    >
      <span
        aria-hidden
        className="inline-flex size-7 items-center justify-center rounded-full border-2 border-dashed border-(--tl-field-border) text-[13px] font-bold text-(--tl-muted)"
      >
        ?
      </span>
    </button>
  );
}
