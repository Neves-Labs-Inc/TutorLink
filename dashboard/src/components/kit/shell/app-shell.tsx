// The app frame for every role. ≥1024px: floating sidebar + content.
// <1024px: compact top bar (wordmark, avatar), content, and the
// floating pill tab bar. The sidebar user card and the phone avatar both
// open the person's Profile (navigates to "profile"). Presentational:
// the caller passes the signed-in person and the nav items.
import type { ReactNode } from "react";
import { cn } from "@/components/kit/tokens";
import { Avatar } from "@/components/kit/components/badges";
import { BottomTabBar } from "@/components/kit/shell/bottom-tab-bar";
import type { NavId, NavItem } from "@/components/kit/shell/nav";
import { Sidebar } from "@/components/kit/shell/sidebar";
import { Wordmark } from "@/components/kit/shell/wordmark";

type AppShellProps = {
  name: string;
  roleLabel: string;
  items: NavItem[];
  activeId: NavId;
  onNavigate: (id: NavId) => void;
  children: ReactNode;
};

export function AppShell({
  name,
  roleLabel,
  items,
  activeId,
  onNavigate,
  children,
}: AppShellProps): ReactNode {
  const isProfile = activeId === "profile";

  return (
    <div className="flex min-h-full">
      <Sidebar
        items={items}
        activeId={activeId}
        onNavigate={onNavigate}
        userName={name}
        userRole={roleLabel}
        onOpenProfile={() => onNavigate("profile")}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-4 pt-3 @2xl:px-6 @5xl:hidden">
          <Wordmark isCompact />
          <button
            type="button"
            onClick={() => onNavigate("profile")}
            aria-label={`Your profile: ${name}`}
            aria-current={isProfile ? "page" : undefined}
            className={cn(
              "inline-flex size-11 cursor-pointer items-center justify-center rounded-full",
              isProfile && "ring-2 ring-(--tl-primary)",
            )}
          >
            <Avatar name={name} />
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-8 @2xl:px-6 @5xl:px-10 @5xl:pt-4 @5xl:pb-12">
          {children}
        </main>
        <BottomTabBar items={items} activeId={activeId} onNavigate={onNavigate} />
      </div>
    </div>
  );
}
