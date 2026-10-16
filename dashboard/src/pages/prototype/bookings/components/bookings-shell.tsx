// The kit's AppShell, rebuilt from its own parts so the Bookings nav
// badge can show this page's count. Nav clicks outside
// Bookings just toast: other areas have their own prototypes.
import type { ReactNode } from "react";
import { CURRENT_USER } from "@/pages/prototype/shared/mock-data";
import { Avatar } from "@/components/kit/components/badges";
import { BottomTabBar } from "@/components/kit/shell/bottom-tab-bar";
import type { NavId } from "@/components/kit/shell/nav";
import { Sidebar } from "@/components/kit/shell/sidebar";
import { Wordmark } from "@/components/kit/shell/wordmark";
import { useToast } from "@/components/kit/overlays/use-toast";
import { getMockNav } from "@/pages/prototype/shared/mock-nav";

type OfficeRole = "admin" | "manager";

type BookingsShellProps = {
  role: OfficeRole;
  badgeCount: number;
  onOpenBookings: () => void;
  children: ReactNode;
};

export default function BookingsShell({
  role,
  badgeCount,
  onOpenBookings,
  children,
}: BookingsShellProps): ReactNode {
  const { showToast } = useToast();
  const user = CURRENT_USER[role];
  const items = getMockNav(role).map((item) =>
    item.id === "bookings"
      ? {
          ...item,
          badge:
            badgeCount > 0
              ? { count: badgeCount, label: "need attention", tone: "pink" as const }
              : undefined,
        }
      : item,
  );

  function handleNavigate(id: NavId): void {
    if (id === "bookings") {
      onOpenBookings();
      return;
    }
    showToast({
      tone: "info",
      message: "This prototype covers Bookings only.",
    });
  }

  return (
    <div className="flex min-h-full">
      <Sidebar
        items={items}
        activeId="bookings"
        onNavigate={handleNavigate}
        userName={user.name}
        userRole={user.role}
        onOpenProfile={() => handleNavigate("profile")}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 px-4 pt-3 @2xl:px-6 @5xl:hidden">
          <Wordmark isCompact />
          <button
            type="button"
            onClick={() => handleNavigate("profile")}
            aria-label={`Your profile: ${user.name}`}
            className="inline-flex size-11 cursor-pointer items-center justify-center rounded-full"
          >
            <Avatar name={user.name} />
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 pb-8 @2xl:px-6 @5xl:px-10 @5xl:pt-4 @5xl:pb-12">
          {children}
        </main>
        <BottomTabBar items={items} activeId="bookings" onNavigate={handleNavigate} />
      </div>
    </div>
  );
}
