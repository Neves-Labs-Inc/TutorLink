import type { ReactNode } from "react";

type DayGroupItemProps = { heading: string | null; children: ReactNode };

// A day separator before the first message of each day. The rules are
// decoration; the day itself is read out, so the context isn't lost.
export default function DayGroupItem({
  heading,
  children,
}: DayGroupItemProps): ReactNode {
  return (
    <>
      {heading && (
        <li className="flex items-center gap-3 py-1">
          <span aria-hidden className="h-px flex-1 bg-(--tl-border)" />
          <span className="text-[12px] font-semibold text-(--tl-muted)">
            {heading}
          </span>
          <span aria-hidden className="h-px flex-1 bg-(--tl-border)" />
        </li>
      )}
      {children}
    </>
  );
}
