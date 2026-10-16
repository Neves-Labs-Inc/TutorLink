// Phone and tablet nav (<1024px): a floating pill bar stuck to the
// bottom of the scroll area. It holds at most 5 tabs: with more items,
// the first 4 show and the rest go under "More", a sheet that lists
// them with their badges. More carries the sum of what's inside it.
import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { CountBadge } from "@/components/kit/components/badges";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import type {
  NavBadge,
  NavId,
  NavItem,
} from "@/components/kit/shell/nav";

const MAX_TABS = 5;
const TABS_BEFORE_MORE = MAX_TABS - 1;

type BottomTabBarProps = {
  items: NavItem[];
  activeId: NavId;
  onNavigate: (id: NavId) => void;
};

export function BottomTabBar({
  items,
  activeId,
  onNavigate,
}: BottomTabBarProps): ReactNode {
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const hasMore = items.length > MAX_TABS;
  const tabs = hasMore ? items.slice(0, TABS_BEFORE_MORE) : items;
  const overflow = hasMore ? items.slice(TABS_BEFORE_MORE) : [];
  const overflowCount = overflow.reduce(
    (total, item) => total + (item.badge?.count ?? 0),
    0,
  );
  const isMoreActive = overflow.some((item) => item.id === activeId);

  function handlePick(id: NavId): void {
    setIsMoreOpen(false);
    onNavigate(id);
  }

  return (
    <nav
      aria-label="Main"
      className="sticky bottom-0 z-20 px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] @5xl:hidden"
    >
      <ul className="kit-shadow-raised mx-auto flex max-w-[560px] items-stretch rounded-[28px] border border-(--tl-card-border) bg-(--tl-surface) p-1.5">
        {tabs.map((item) => (
          <li key={item.id} className="min-w-0 flex-1">
            <Tab
              icon={item.icon}
              label={item.label}
              badge={item.badge}
              isActive={item.id === activeId}
              onClick={() => onNavigate(item.id)}
            />
          </li>
        ))}
        {hasMore && (
          <li className="min-w-0 flex-1">
            <Tab
              icon={Ellipsis}
              label="More"
              badge={
                overflowCount > 0
                  ? { count: overflowCount, label: "waiting", tone: "pink" }
                  : undefined
              }
              isActive={isMoreActive}
              hasPopup
              onClick={() => setIsMoreOpen(true)}
            />
          </li>
        )}
      </ul>
      <BottomSheet
        isOpen={isMoreOpen}
        onClose={() => setIsMoreOpen(false)}
        title="More"
      >
        <ul className="-mx-2 flex flex-col">
          {overflow.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeId;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => handlePick(item.id)}
                  className={cn(
                    "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[18px] px-3 text-left text-[15px] transition-colors duration-150 hover:bg-(--tl-tint)",
                    isActive
                      ? "bg-(--tl-tint-strong) font-semibold text-(--tl-primary-ink)"
                      : "font-medium",
                  )}
                >
                  <span className="inline-flex size-10 items-center justify-center rounded-[14px] bg-(--tl-tint) text-(--tl-primary-ink)">
                    <Icon aria-hidden className="size-5" />
                  </span>
                  <span className="flex-1">{item.label}</span>
                  {item.badge && item.badge.count > 0 && (
                    <CountBadge
                      count={item.badge.count}
                      tone={item.badge.tone}
                      label={item.badge.label}
                    />
                  )}
                  <ChevronRight aria-hidden className="size-5 text-(--tl-muted)" />
                </button>
              </li>
            );
          })}
        </ul>
      </BottomSheet>
    </nav>
  );
}

type TabProps = {
  icon: LucideIcon;
  label: string;
  badge?: NavBadge;
  isActive: boolean;
  hasPopup?: boolean;
  onClick: () => void;
};

function Tab({
  icon: Icon,
  label,
  badge,
  isActive,
  hasPopup = false,
  onClick,
}: TabProps): ReactNode {
  const shownBadge = badge && badge.count > 0 ? badge : null;
  return (
    <button
      type="button"
      aria-current={isActive && !hasPopup ? "page" : undefined}
      aria-haspopup={hasPopup ? "dialog" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-h-14 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-[22px] px-1 text-[12px] font-medium",
        isActive ? "text-(--tl-primary-ink)" : "text-(--tl-muted)",
      )}
    >
      <span
        className={cn(
          "relative inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-150",
          isActive && "bg-(--tl-tint-strong)",
        )}
      >
        <Icon aria-hidden className="size-5" />
        {shownBadge && (
          <span
            className={cn(
              "absolute -top-1.5 -right-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-(--tl-surface) px-1 text-[12px] leading-none font-semibold tabular-nums",
              shownBadge.tone === "pink"
                ? "bg-(--tl-pink-tint) text-(--tl-pink-ink)"
                : "bg-(--tl-primary) text-(--tl-on-primary)",
            )}
          >
            {shownBadge.count}
            <span className="sr-only"> {shownBadge.label}</span>
          </span>
        )}
      </span>
      <span className="max-w-full truncate text-center leading-4">{label}</span>
    </button>
  );
}
