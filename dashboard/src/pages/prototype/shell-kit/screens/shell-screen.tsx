// screen=shell: the real shell for the chosen role with a sample page
// behind every nav item. Click the nav to move between them.
import { useState } from "react";
import type { ReactNode } from "react";
import type { Role } from "@/pages/prototype/shell-kit/kit/mock-data";
import { AppShell } from "@/pages/prototype/shell-kit/kit/shell/app-shell";
import { getLandingNavId } from "@/pages/prototype/shell-kit/kit/shell/nav";
import type { NavId } from "@/pages/prototype/shell-kit/kit/shell/nav";
import AccountsPage from "@/pages/prototype/shell-kit/screens/shell-pages/accounts-page";
import BookingsPage from "@/pages/prototype/shell-kit/screens/shell-pages/bookings-page";
import ChatsPage from "@/pages/prototype/shell-kit/screens/shell-pages/chats-page";
import HomePage from "@/pages/prototype/shell-kit/screens/shell-pages/home-page";
import MyAvailabilityPage from "@/pages/prototype/shell-kit/screens/shell-pages/my-availability-page";
import MySessionsPage from "@/pages/prototype/shell-kit/screens/shell-pages/my-sessions-page";
import ProfilePage from "@/pages/prototype/shell-kit/screens/shell-pages/profile-page";
import StaffPage from "@/pages/prototype/shell-kit/screens/shell-pages/staff-page";
import SettingsPage from "@/pages/prototype/shell-kit/screens/shell-pages/settings-page";
import TimeOffPage from "@/pages/prototype/shell-kit/screens/shell-pages/time-off-page";

function renderPage(
  id: NavId,
  role: Role,
  onNavigate: (id: NavId) => void,
): ReactNode {
  const pages: Record<NavId, ReactNode> = {
    home: <HomePage role={role} onNavigate={onNavigate} />,
    bookings: <BookingsPage role={role} />,
    chats: <ChatsPage />,
    accounts: <AccountsPage />,
    staff: <StaffPage role={role} />,
    settings: <SettingsPage />,
    profile: <ProfilePage role={role} />,
    "my-sessions": <MySessionsPage role={role} />,
    "my-availability": <MyAvailabilityPage />,
    "time-off": <TimeOffPage role={role} />,
  };
  return pages[id];
}

type ShellScreenProps = { role: Role };

export default function ShellScreen({ role }: ShellScreenProps): ReactNode {
  const [activeId, setActiveId] = useState<NavId>(getLandingNavId(role));

  function handleNavigate(id: NavId): void {
    setActiveId(id);
    document.querySelector("[data-kit-scroll]")?.scrollTo({ top: 0 });
  }

  return (
    <AppShell role={role} activeId={activeId} onNavigate={handleNavigate}>
      <div key={activeId} className="kit-fade">
        {renderPage(activeId, role, handleNavigate)}
      </div>
    </AppShell>
  );
}
