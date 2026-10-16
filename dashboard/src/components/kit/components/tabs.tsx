// Two kinds of tabs, kept visually apart on purpose:
// - SubPageTabs: navigation between sub-pages (People ▸ Children /
//   Guardians / Staff). Underlined, scrolls sideways on phones.
// - SegmentedControl: switches the view of the same data (List /
//   Calendar). A sunk pill track with a raised thumb.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { CountBadge } from "@/components/kit/components/badges";

export type TabItem = {
  id: string;
  label: string;
  count?: number;
  icon?: LucideIcon;
};

type SubPageTabsProps = {
  label: string;
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
};

export function SubPageTabs({
  label,
  items,
  activeId,
  onChange,
}: SubPageTabsProps): ReactNode {
  return (
    <nav
      aria-label={label}
      className="kit-no-scrollbar -mx-4 overflow-x-auto px-4 @2xl:mx-0 @2xl:px-0"
    >
      <ul className="flex min-w-max gap-1 border-b border-(--tl-border)">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id}>
              <button
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onChange(item.id)}
                className={cn(
                  "relative inline-flex h-12 cursor-pointer items-center gap-2 rounded-t-[14px] px-4 text-[15px] whitespace-nowrap transition-colors duration-150",
                  isActive
                    ? "font-semibold text-(--tl-primary-ink)"
                    : "font-medium text-(--tl-muted) hover:text-(--tl-ink)",
                )}
              >
                {item.label}
                {item.count !== undefined && (
                  <CountBadge
                    count={item.count}
                    tone={isActive ? "pink" : "quiet"}
                  />
                )}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-3 -bottom-px h-[3px] rounded-full transition-colors duration-150",
                    isActive ? "bg-(--tl-primary)" : "bg-transparent",
                  )}
                />
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

type SegmentedControlProps = {
  label: string;
  items: TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  isFullWidth?: boolean;
};

export function SegmentedControl({
  label,
  items,
  activeId,
  onChange,
  isFullWidth = false,
}: SegmentedControlProps): ReactNode {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "rounded-full bg-(--tl-surface-sunk) p-1",
        isFullWidth
          ? "grid auto-cols-fr grid-flow-col"
          : "kit-no-scrollbar inline-flex w-fit max-w-full overflow-x-auto",
      )}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(item.id)}
            className={cn(
              // 40px inside the 4px track keeps the whole control at 48.
              "inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150",
              isActive
                ? "kit-shadow-soft bg-(--tl-surface) text-(--tl-primary-ink)"
                : "text-(--tl-muted) hover:text-(--tl-ink)",
            )}
          >
            {Icon && <Icon aria-hidden className="size-4" />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
