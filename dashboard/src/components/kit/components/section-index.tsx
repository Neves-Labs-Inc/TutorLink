// "On this page": jumps to a group. A sideways-scrolling row of pills on
// phones, a sticky column beside the groups from @5xl. Each entry shows
// how many unsaved changes its group holds.
import type { ReactNode } from "react";
import { CountBadge } from "@/components/kit/components/badges";
import { getSectionHeadingId } from "@/components/kit/lib/section-anchors";
import { prefersReducedMotion } from "@/components/kit/overlays/use-enter-animation";
import { cn } from "@/components/kit/tokens";

export type IndexSection = { id: string; title: string; count: number };

type SectionIndexProps = {
  label: string;
  sections: IndexSection[];
  layout: "row" | "column";
};

function jumpTo(id: string): void {
  document.getElementById(id)?.scrollIntoView({
    block: "start",
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
  // So keyboard and screen-reader users land in the group, not on the button.
  document
    .getElementById(getSectionHeadingId(id))
    ?.focus({ preventScroll: true });
}

export function SectionIndex({
  label,
  sections,
  layout,
}: SectionIndexProps): ReactNode {
  const isColumn = layout === "column";
  return (
    <nav
      aria-label={label}
      className={cn(
        isColumn
          ? "sticky top-6 hidden self-start @5xl:block"
          : "kit-no-scrollbar -mx-4 scroll-px-4 overflow-x-auto px-4 @5xl:hidden",
      )}
    >
      <ul className={cn("flex gap-2", isColumn ? "flex-col" : "min-w-max")}>
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => jumpTo(section.id)}
              className={cn(
                "flex h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-[14px] font-medium whitespace-nowrap text-(--tl-ink-soft) transition-colors duration-150 hover:bg-(--tl-tint) hover:text-(--tl-ink) active:bg-(--tl-tint-strong)",
                isColumn
                  ? "w-full justify-between"
                  : "border border-(--tl-border) bg-(--tl-surface)",
              )}
            >
              {section.title}
              {section.count > 0 && (
                <CountBadge
                  count={section.count}
                  tone="yellow"
                  label="unsaved changes"
                />
              )}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
