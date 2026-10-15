// The app frame for every role. ≥1024px: floating sidebar + content.
// <1024px: compact top bar (wordmark, avatar), content, and the
// floating pill tab bar. The sidebar user card and the phone avatar both
// open the person's Profile (navigates to "profile").
import type { ReactNode } from "react";
import { CURRENT_USER } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Role } from "@/pages/prototype/shell-kit/kit/mock-data";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { BottomTabBar } from "@/pages/prototype/shell-kit/kit/shell/bottom-tab-bar";
import { getNav } from "@/pages/prototype/shell-kit/kit/shell/nav";
import type { NavId } from "@/pages/prototype/shell-kit/kit/shell/nav";
import { Sidebar } from "@/pages/prototype/shell-kit/kit/shell/sidebar";
import { Wordmark } from "@/pages/prototype/shell-kit/kit/shell/wordmark";

type AppShellProps = {
  role: Role;
  activeId: NavId;
  onNavigate: (id: NavId) => void;
  children: ReactNode;
};

export function AppShell({
  role,
  activeId,
  onNavigate,
  children,
}: AppShellProps): ReactNode {
  const user = CURRENT_USER[role];
  const items = getNav(role);
  const isProfile = activeId === "profile";

  return (
    <div className="flex min-h-full">
      <Sidebar
        items={items}
        activeId={activeId}
        onNavigate={onNavigate}
        userName={user.name}
        userRole={user.role}
        onOpenProfile={() => onNavigate("profile")}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-4 pt-3 @2xl:px-6 @5xl:hidden">
          <Wordmark isCompact />
          <button
            type="button"
            onClick={() => onNavigate("profile")}
            aria-label={`Your profile: ${user.name}`}
            aria-current={isProfile ? "page" : undefined}
            className={cn(
              "inline-flex size-11 cursor-pointer items-center justify-center rounded-full",
              isProfile && "ring-2 ring-(--tl-primary)",
            )}
          >
            <Avatar name={user.name} />
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
