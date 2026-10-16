// The kit's AppShell with nav badges from GET /api/counts, using this
// area's own Bookings badge wording.
import type { ReactNode } from "react";
import { AppShell } from "@/components/kit/shell/app-shell";
import { getNav } from "@/components/kit/shell/nav";
import type { NavBadge, NavId, NavItem } from "@/components/kit/shell/nav";
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
  return getNav(role, { hasOfficeTimeOff: true }).map((item) => ({
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

  return (
    <AppShell
      name={user.name}
      roleLabel={ROLE_LABEL[user.role]}
      items={getItems(role, counts)}
      activeId={activeId}
      onNavigate={onNavigate}
    >
      {children}
    </AppShell>
  );
}
