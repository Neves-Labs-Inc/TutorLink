// A collapsible "To sort out · n" strip above a list. Open by
// default; the open/closed state lives in the component. Each row is one
// button that opens its record (hover/pressed tint, ≥56px). Renders
// nothing when there are no rows.
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";

export type AttentionRow = {
  id: string;
  icon: LucideIcon;
  iconClasses: string;
  title: string;
  detail: string;
  cue: string;
  onOpen: () => void;
};

export type AttentionGroup = { title: string; rows: AttentionRow[] };

type AttentionBannerProps = { title: string; groups: AttentionGroup[] };

export function AttentionBanner({
  title,
  groups,
}: AttentionBannerProps): ReactNode {
  const [isOpen, setIsOpen] = useState(true);
  const panelId = useId();
  const shown = groups.filter((group) => group.rows.length > 0);
  const count = shown.reduce((total, group) => total + group.rows.length, 0);
  if (count === 0) return null;

  return (
    <section
      aria-label={title}
      className="mb-6 overflow-hidden rounded-[20px] border border-(--tl-warning)/30 bg-(--tl-warning-tint)"
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen(!isOpen)}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 text-left text-(--tl-warning) transition-colors duration-150 hover:bg-(--tl-warning)/5 @2xl:px-5"
      >
        <CircleAlert aria-hidden className="size-5 shrink-0" />
        <span className="flex-1 text-[15px] font-semibold">
          {title} · <span className="tabular-nums">{count}</span>
        </span>
        <span className="text-[13px] font-medium">{isOpen ? "Hide" : "Show"}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-5 transition-transform duration-150",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {isOpen && (
        <div
          id={panelId}
          className="grid gap-3 px-2 pb-2 @3xl:grid-cols-2 @3xl:gap-2"
        >
          {shown.map((group) => (
            <div key={group.title} className="rounded-[16px] bg-(--tl-surface) p-2">
              <h3 className="px-2 pt-1 pb-1 text-[12px] font-semibold tracking-[0.1em] text-(--tl-muted) uppercase">
                {group.title} · {group.rows.length}
              </h3>
              <ul className="flex flex-col">
                {group.rows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={row.onOpen}
                        className="group flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[12px] px-2 py-2 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)"
                      >
                        <span
                          className={cn(
                            "inline-flex size-9 shrink-0 items-center justify-center rounded-[12px]",
                            row.iconClasses,
                          )}
                        >
                          <Icon aria-hidden className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] leading-5 font-semibold">
                            {row.title}
                          </span>
                          <span className="block truncate text-[13px] leading-[18px] text-(--tl-muted)">
                            {row.detail}
                          </span>
                        </span>
                        <span className="hidden shrink-0 items-center gap-0.5 text-[13px] font-semibold text-(--tl-link) @md:inline-flex">
                          {row.cue}
                          <ChevronRight aria-hidden className="size-4" />
                        </span>
                        <ChevronRight
                          aria-hidden
                          className="size-5 shrink-0 text-(--tl-muted) @md:hidden"
                        />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
