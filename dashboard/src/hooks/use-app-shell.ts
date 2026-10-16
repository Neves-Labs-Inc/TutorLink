import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { getNav, getNavIdForPath } from "@/components/kit/shell/nav";
import type { NavId, NavItem } from "@/components/kit/shell/nav";
import { isOfficeRole } from "@/lib/auth/auth";
import type { Role } from "@/lib/auth/auth";
import { countsQueries } from "@/lib/queries/counts";
import { meQueries } from "@/lib/queries/me";
import { roleLabel } from "@/lib/users/users";

type AppShellData = {
  items: NavItem[];
  activeId: NavId | null;
  // null while /api/me loads or after it fails.
  name: string | null;
  isPersonError: boolean;
  roleLabel: string;
};

// What the signed-in shell shows: the role's nav with live badges, the
// item for the current path, and the person.
export function useAppShell(role: Role): AppShellData {
  const { pathname } = useLocation();
  const me = useQuery(meQueries.detail());
  const counts = useQuery({
    ...countsQueries.detail(),
    enabled: isOfficeRole(role),
  });
  // A failed refresh hides the badges rather than keeping stale ones.
  const shownCounts = counts.isError ? null : (counts.data ?? null);

  return {
    items: getNav(role, { counts: shownCounts }),
    activeId: getNavIdForPath(pathname),
    name: me.data?.name ?? null,
    isPersonError: me.isError,
    roleLabel: roleLabel(role),
  };
}
