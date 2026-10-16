// Dashed asides that are never part of the design. `question` marks a
// placeholder for an open flow question ("?"); `note` explains a choice.
import type { ReactNode } from "react";
import { FlaskConical } from "lucide-react";
import { cn } from "@/components/kit/tokens";

type PrototypeNoteProps = {
  kind?: "note" | "question";
  children: ReactNode;
};

export default function PrototypeNote({
  kind = "note",
  children,
}: PrototypeNoteProps): ReactNode {
  const isQuestion = kind === "question";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[14px] border border-dashed px-3 py-2 text-[12px] leading-[18px]",
        isQuestion
          ? "border-(--tl-warning) text-(--tl-warning)"
          : "border-(--tl-field-border) text-(--tl-muted)",
      )}
    >
      {isQuestion ? (
        <span
          aria-hidden
          className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border border-dashed border-current text-[11px] font-bold"
        >
          ?
        </span>
      ) : (
        <FlaskConical aria-hidden className="mt-px size-3.5 shrink-0" />
      )}
      <span>
        <span className="font-semibold">
          {isQuestion ? "Open question:" : "Prototype:"}
        </span>{" "}
        {children}
      </span>
    </div>
  );
}
