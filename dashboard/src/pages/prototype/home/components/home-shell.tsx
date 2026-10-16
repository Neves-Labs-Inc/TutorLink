// A local copy of the kit's AppShell that takes its nav badges from
// GET /api/counts instead of the kit's mock data. Needed because the
// kit's AppShell builds its own items (kit change requested: let
// AppShell take `items`, or a `counts` prop).
import type { ReactNode } from "react";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { BottomTabBar } from "@/pages/prototype/shell-kit/kit/shell/bottom-tab-bar";
import { getNav } from "@/pages/prototype/shell-kit/kit/shell/nav";
import type { NavBadge, NavId, NavItem } from "@/pages/prototype/shell-kit/kit/shell/nav";
import { Sidebar } from "@/pages/prototype/shell-kit/kit/shell/sidebar";
import { Wordmark } from "@/pages/prototype/shell-kit/kit/shell/wordmark";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { CURRENT_STAFF } from "@/pages/prototype/home/lib/mock-api";
import type { OfficeRole } from "@/pages/prototype/home/lib/mock-api";
import { ROLE_LABEL } from "@/pages/prototype/home/lib/labels";
import type { CountsRead } from "@/pages/prototype/home/types/api";

function getBadge(id: NavId, counts: CountsRead): NavBadge | undefined {
  // Bookings counts what To do › Bookings holds: Bookings to deal with
  // plus Children with an Evaluation to book (Franklin, 2026-10-15).
  const badges: Partial<Record<NavId, NavBadge>> = {
    bookings: {
      count: counts.bookings_to_sort_out + counts.children_awaiting_evaluation,
      label: "to deal with",
      tone: "pink",
    },
    chats: { count: counts.unread_chats, label: "unread", tone: "primary" },
  };
  if (counts.time_off_pending !== null) {
    badges["time-off"] = {
      count: counts.time_off_pending,
      label: "to review",
      tone: "pink",
    };
  }
  return badges[id];
}

function getItems(role: OfficeRole, counts: CountsRead | null): NavItem[] {
  // While counts load, no badges rather than stale or zero ones.
  return getNav(role).map((item) => ({
    ...item,
    badge: counts ? getBadge(item.id, counts) : undefined,
  }));
}

type HomeShellProps = {
  role: OfficeRole;
  counts: CountsRead | null;
  activeId: NavId;
  onNavigate: (id: NavId) => void;
  children: ReactNode;
};

export default function HomeShell({
  role,
  counts,
  activeId,
  onNavigate,
  children,
}: HomeShellProps): ReactNode {
  const user = CURRENT_STAFF[role];
  const items = getItems(role, counts);
  const isProfile = activeId === "profile";

  return (
    <div className="flex min-h-full">
      <Sidebar
        items={items}
        activeId={activeId}
        onNavigate={onNavigate}
        userName={user.name}
        userRole={ROLE_LABEL[user.role]}
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
