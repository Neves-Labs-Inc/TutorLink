// The signed-in frame for every guarded route (a layout route): one
// KitRoot on the chosen theme, the kit AppShell with the role's nav, the
// leave guard every nav goes through, Booking details and the booking
// form any page can open, and the old Toaster for screens not yet rebuilt.
import { useEffect } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import KitRoot from "@/components/kit/kit-root";
import BookingOverlaysProvider from "@/components/booking-overlays/booking-overlays-provider";
import { AppShell } from "@/components/kit/shell/app-shell";
import type { NavId } from "@/components/kit/shell/nav";
import LeaveGuardProvider from "@/components/layout/leave-guard-provider";
import Toaster from "@/components/shared/Toaster";
import { useAppShell } from "@/hooks/use-app-shell";
import { useGuardedNavigate } from "@/hooks/use-leave-guard";
import { useTheme } from "@/hooks/use-theme";
import type { Role } from "@/lib/auth/auth";
import { useAuthStore } from "@/stores/authStore";

const PROFILE_PATH = "/profile";

type AppLayoutProps = {
  // Shown in place of the matched child route (the catch-all page).
  children?: ReactNode;
};

export default function AppLayout({ children }: AppLayoutProps): ReactNode {
  const role = useAuthStore((state) => state.role);
  const { theme } = useTheme();
  // The route guard around this layout has already settled a role.
  if (role === null) return null;

  return (
    <>
      <KitRoot theme={theme}>
        <LeaveGuardProvider>
          <BookingOverlaysProvider>
            <SignedInShell role={role}>{children}</SignedInShell>
          </BookingOverlaysProvider>
        </LeaveGuardProvider>
      </KitRoot>
      <Toaster aboveTabBar />
    </>
  );
}

type SignedInShellProps = { role: Role; children?: ReactNode };

function SignedInShell({ role, children }: SignedInShellProps): ReactNode {
  // Asks first while a page holds unsaved changes.
  const navigate = useGuardedNavigate();
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
      {children ?? <Outlet />}
    </AppShell>
  );
}
