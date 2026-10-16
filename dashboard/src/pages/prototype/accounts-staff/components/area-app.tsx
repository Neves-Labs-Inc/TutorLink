// The kit's AppShell around the two sections this prototype owns,
// Accounts and Staff. Other nav items toast: they have their own
// prototypes. Holds the in-memory store and the fake request phase.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { CURRENT_USER } from "@/pages/prototype/shared/mock-data";
import { AppShell } from "@/components/kit/shell/app-shell";
import { getNav } from "@/components/kit/shell/nav";
import type { NavId } from "@/components/kit/shell/nav";
import { useToast } from "@/components/kit/overlays/use-toast";
import AccountsPage from "@/pages/prototype/accounts-staff/components/accounts-page";
import StaffPage from "@/pages/prototype/accounts-staff/components/staff-page";
import {
  AreaStoreContext,
  useAreaStoreState,
} from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { readCounts } from "@/pages/prototype/accounts-staff/lib/mock-api";
import { CURRENT_STAFF_ID } from "@/pages/prototype/accounts-staff/lib/mock-data";
import type {
  DataState,
  OfficeRole,
  Phase,
  Screen,
} from "@/pages/prototype/accounts-staff/types/screens";

const RETRY_MS = 900;
const STAFF_SCREENS: Screen[] = [
  "staff",
  "staff-archived",
  "staff-detail",
  "staff-children",
  "add-staff",
  "staff-setup",
];

type Section = "accounts" | "staff";

type AreaAppProps = {
  screen: Screen;
  role: OfficeRole;
  dataState: DataState;
};

function getInitialPhase(dataState: DataState): Phase {
  if (dataState === "loading") return "loading";
  return dataState === "error" ? "error" : "ready";
}

export default function AreaApp({
  screen,
  role,
  dataState,
}: AreaAppProps): ReactNode {
  const { showToast } = useToast();
  const user = CURRENT_USER[role];
  const store = useAreaStoreState(
    {
      isEmpty: dataState === "empty",
      hasJustAddedTutor: screen === "staff-setup",
    },
    { id: CURRENT_STAFF_ID[role], name: user.name },
  );
  const [phase, setPhase] = useState<Phase>(() => getInitialPhase(dataState));
  const [isRetrying, setIsRetrying] = useState(false);
  const [visit, setVisit] = useState(0);
  const [jumpChildId, setJumpChildId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>(
    STAFF_SCREENS.includes(screen) ? "staff" : "accounts",
  );

  // A retry from the error state "succeeds" after a short wait.
  useEffect(() => {
    if (!isRetrying) return;
    const timer = window.setTimeout(() => {
      setIsRetrying(false);
      setPhase("ready");
    }, RETRY_MS);
    return () => window.clearTimeout(timer);
  }, [isRetrying]);

  function handleRetry(): void {
    setPhase("loading");
    setIsRetrying(true);
  }

  // Staff details › Children: open that Child in its family.
  function handleOpenChild(childId: string): void {
    setJumpChildId(childId);
    setSection("accounts");
    setVisit((count) => count + 1);
    document.querySelector("[data-kit-scroll]")?.scrollTo({ top: 0 });
  }

  function handleNavigate(id: NavId): void {
    if (id === "accounts" || id === "staff") {
      setJumpChildId(null);
      setSection(id);
      // Tapping the current item again goes back to its list.
      setVisit((count) => count + 1);
      document.querySelector("[data-kit-scroll]")?.scrollTo({ top: 0 });
      return;
    }
    showToast({
      tone: "info",
      message: "This prototype covers Families and Staff. Other areas have their own.",
    });
  }

  const counts = phase === "ready" ? readCounts(store.db, role === "admin") : null;
  // Only the first visit starts from the switcher's screen.
  const isStartScreen =
    visit === 0 && section === (STAFF_SCREENS.includes(screen) ? "staff" : "accounts");

  return (
    <AreaStoreContext.Provider value={store}>
      <AppShell
        name={user.name}
        roleLabel={user.role}
        items={getNav(role, counts)}
        activeId={section}
        onNavigate={handleNavigate}
      >
        <div key={`${section}-${visit}`} className="kit-fade">
          {section === "accounts" ? (
            <AccountsPage
              phase={phase}
              onRetry={handleRetry}
              startScreen={isStartScreen ? screen : "families"}
              startChildId={jumpChildId}
            />
          ) : (
            <StaffPage
              role={role}
              phase={phase}
              onRetry={handleRetry}
              startScreen={isStartScreen ? screen : "staff"}
              onOpenChild={handleOpenChild}
            />
          )}
        </div>
      </AppShell>
    </AreaStoreContext.Provider>
  );
}
