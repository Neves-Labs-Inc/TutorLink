// The signed-in frame for every guarded route (a layout route): one
// KitRoot on the chosen theme, the kit AppShell with the role's nav, and
// the old Toaster for screens not yet rebuilt.
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import KitRoot from "@/components/kit/kit-root";
import { AppShell } from "@/components/kit/shell/app-shell";
import type { NavId } from "@/components/kit/shell/nav";
import Toaster from "@/components/shared/Toaster";
import { useAppShell } from "@/hooks/use-app-shell";
import { useTheme } from "@/hooks/use-theme";
import type { Role } from "@/lib/auth/auth";
import { useAuthStore } from "@/stores/authStore";

const PROFILE_PATH = "/profile";

export default function AppLayout(): ReactNode {
  const role = useAuthStore((state) => state.role);
  const { theme } = useTheme();
  // The route guard around this layout has already settled a role.
  if (role === null) return null;

  return (
    <>
      <KitRoot theme={theme}>
        <SignedInShell role={role} />
      </KitRoot>
      <Toaster aboveTabBar />
    </>
  );
}

type SignedInShellProps = { role: Role };

function SignedInShell({ role }: SignedInShellProps): ReactNode {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { items, activeId, name, isPersonError, roleLabel } =
    useAppShell(role);

  // The page scrolls inside the kit root, not the window.
  useEffect(() => {
    document.querySelector("[data-kit-scroll]")?.scrollTo({ top: 0 });
  }, [pathname]);

  function handleNavigate(id: NavId): void {
    const path =
      id === "profile"
        ? PROFILE_PATH
        : items.find((item) => item.id === id)?.path;
    if (path && path !== pathname) navigate(path);
  }

  return (
    <AppShell
      name={name}
      isPersonError={isPersonError}
      roleLabel={roleLabel}
      items={items}
      activeId={activeId}
      onNavigate={handleNavigate}
    >
      <Outlet />
    </AppShell>
  );
}
