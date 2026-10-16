// "On this page": jumps to a group. A sticky list beside the groups on
// wide screens; a sideways-scrolling row of pills on phones. A dot marks
// a group with unsaved changes.
import type { ReactNode } from "react";
import { cn } from "@/components/kit/tokens";
import type { SectionDef } from "@/pages/prototype/settings/lib/sections";

type SectionIndexProps = {
  sections: SectionDef[];
  changedIn: (id: SectionDef["id"]) => number;
  layout: "column" | "row";
};

function jumpTo(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function SectionIndex({
  sections,
  changedIn,
  layout,
}: SectionIndexProps): ReactNode {
  const isColumn = layout === "column";
  return (
    <nav
      aria-label="Settings groups"
      className={cn(
        isColumn
          ? "sticky top-6 hidden self-start @5xl:block"
          : "kit-no-scrollbar -mx-4 overflow-x-auto px-4 @5xl:hidden",
      )}
    >
      <ul className={cn("flex gap-1", isColumn ? "flex-col" : "min-w-max")}>
        {sections.map((section) => {
          const hasChanges = changedIn(section.id) > 0;
          return (
            <li key={section.id}>
              <button
                type="button"
                onClick={() => jumpTo(section.id)}
                className={cn(
                  "flex h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-[14px] font-medium whitespace-nowrap text-(--tl-ink-soft) transition-colors duration-150 hover:bg-(--tl-tint) hover:text-(--tl-ink)",
                  isColumn ? "w-full justify-between" : "border border-(--tl-border) bg-(--tl-surface)",
                )}
              >
                {section.title}
                {hasChanges && (
                  <>
                    <span aria-hidden className="size-2 shrink-0 rounded-full bg-(--tl-warning)" />
                    <span className="sr-only">(unsaved changes)</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
