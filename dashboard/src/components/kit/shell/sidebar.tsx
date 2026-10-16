// Desktop nav (≥1024px): a floating rounded panel with the wordmark,
// the role's nav, and the signed-in person at the foot (opens Profile).
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { Avatar, CountBadge } from "@/components/kit/components/badges";
import { Wordmark } from "@/components/kit/shell/wordmark";
import type { NavId, NavItem } from "@/components/kit/shell/nav";

type SidebarProps = {
  items: NavItem[];
  activeId: NavId;
  onNavigate: (id: NavId) => void;
  userName: string;
  userRole: string;
  onOpenProfile: () => void;
};

export function Sidebar({
  items,
  activeId,
  onNavigate,
  userName,
  userRole,
  onOpenProfile,
}: SidebarProps): ReactNode {
  return (
    <aside className="kit-shadow-soft sticky top-4 m-4 mr-0 hidden h-[calc(var(--kit-h)-32px)] w-[248px] shrink-0 flex-col rounded-[28px] border border-(--tl-card-border) bg-(--tl-surface) p-4 @5xl:flex">
      <div className="px-2 pt-2 pb-6">
        <Wordmark />
      </div>
      <nav aria-label="Main" className="flex-1">
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const isActive = item.id === activeId;
            const Icon = item.icon;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    "flex h-11 w-full cursor-pointer items-center gap-3 rounded-full px-4 text-left text-[14px] transition-colors duration-150",
                    isActive
                      ? "bg-(--tl-tint-strong) font-semibold text-(--tl-primary-ink)"
                      : "font-medium text-(--tl-ink-soft) hover:bg-(--tl-tint)",
                  )}
                >
                  <Icon aria-hidden className="size-[18px]" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && item.badge.count > 0 ? (
                    <CountBadge
                      count={item.badge.count}
                      tone={item.badge.tone}
                      label={item.badge.label}
                    />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <button
        type="button"
        onClick={onOpenProfile}
        aria-current={activeId === "profile" ? "page" : undefined}
        className={cn(
          "flex w-full cursor-pointer items-center gap-3 rounded-[20px] p-3 text-left transition-colors duration-150 hover:bg-(--tl-tint-strong)",
          activeId === "profile"
            ? "bg-(--tl-tint-strong) ring-2 ring-(--tl-primary)"
            : "bg-(--tl-tint)",
        )}
      >
        <Avatar name={userName} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">
            {userName}
          </span>
          <span className="block text-[13px] text-(--tl-muted)">
            {userRole}
          </span>
        </span>
        <ChevronRight aria-hidden className="size-4 text-(--tl-muted)" />
        <span className="sr-only">Your profile</span>
      </button>
    </aside>
  );
}
