// Building blocks for detail panels: labelled rows with an icon chip,
// and the yellow Child notes card Tutors see with each Session.
import type { ReactNode } from "react";
import { NotebookPen } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type DetailRowProps = { icon: LucideIcon; label: string; children: ReactNode };

export function DetailRow({
  icon: Icon,
  label,
  children,
}: DetailRowProps): ReactNode {
  return (
    <div className="flex gap-3">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-(--tl-tint) text-(--tl-primary-ink)">
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-[18px] text-(--tl-muted)">{label}</p>
        <div className="mt-0.5 text-[15px] leading-6">{children}</div>
      </div>
    </div>
  );
}

type NotesCardProps = { title?: string; children: ReactNode };

export function NotesCard({
  title = "Child notes",
  children,
}: NotesCardProps): ReactNode {
  return (
    <div className="rounded-[18px] bg-(--tl-yellow-tint) p-4 text-(--tl-yellow-ink)">
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        <NotebookPen aria-hidden className="size-4" />
        {title}
      </p>
      <div className="mt-1.5 text-[14px] leading-6">{children}</div>
    </div>
  );
}
