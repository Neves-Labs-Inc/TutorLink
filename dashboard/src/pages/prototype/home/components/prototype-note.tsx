// A dashed "Prototype" aside marking a placeholder or an open question
// right where it shows. Never part of the real design.
import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";

type PrototypeNoteProps = { children: ReactNode };

export default function PrototypeNote({ children }: PrototypeNoteProps): ReactNode {
  return (
    <p className="flex items-start gap-2 rounded-[14px] border border-dashed border-(--tl-field-border) px-3 py-2 text-[12px] leading-[18px] text-(--tl-muted)">
      <FlaskConical aria-hidden className="mt-px size-3.5 shrink-0" />
      <span>
        <span className="font-semibold">Prototype:</span> {children}
      </span>
    </p>
  );
}
