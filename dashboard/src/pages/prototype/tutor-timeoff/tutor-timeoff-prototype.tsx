// Plan: the Tutor app, Time off and the Manager profile (TutorLink#197)
// on the approved shell kit. Throwaway, DEV-only, mock data in the API's
// wire shapes (PR #224). Route /prototype/tutor-timeoff, driven by the
// floating switcher:
//   ?screen=sessions|session|availability|time-off|time-off-detail|time-off-form|profile
//     sessions, session, availability are the Tutor's; an Office role
//     lands on its profile instead.
//   ?role=tutor|manager|admin
//   ?state=populated|loading|empty|error
//   ?theme=light|dark
//   ?device=desktop|phone        phone frames the page at 390×844
// Every screen is a starting point; the app stays live from there.
import { useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "@/components/shared/PrototypeSwitcher";
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";
import { DeviceFrame } from "@/pages/prototype/shared/device-frame";
import { AppShell } from "@/components/kit/shell/app-shell";
import { CURRENT_USER } from "@/pages/prototype/shared/mock-data";
import { getNav } from "@/components/kit/shell/nav";
import type { NavId } from "@/components/kit/shell/nav";
import type { Theme } from "@/components/kit/tokens";
import ElsewhereScreen from "@/pages/prototype/tutor-timeoff/components/elsewhere-screen";
import type { Elsewhere } from "@/pages/prototype/tutor-timeoff/components/elsewhere-screen";
import MySessionsScreen from "@/pages/prototype/tutor-timeoff/components/my-sessions-screen";
import OwnTimeOffScreen from "@/pages/prototype/tutor-timeoff/components/own-time-off-screen";
import ProfileScreen from "@/pages/prototype/tutor-timeoff/components/profile-screen";
import SessionDetail from "@/pages/prototype/tutor-timeoff/components/session-detail";
import TimeOffQueueScreen from "@/pages/prototype/tutor-timeoff/components/time-off-queue-screen";
import AvailabilitySection from "@/pages/prototype/tutor-timeoff/components/availability-section";
import { PageHeader } from "@/components/kit/shell/page-header";
import { useAreaStore } from "@/pages/prototype/tutor-timeoff/hooks/use-area-store";
import { useLoadPhase } from "@/pages/prototype/tutor-timeoff/hooks/use-load-phase";
import type { DataState } from "@/pages/prototype/tutor-timeoff/hooks/use-load-phase";
import type { AreaRole } from "@/pages/prototype/tutor-timeoff/lib/mock-data";

type Screen =
  | "sessions"
  | "session"
  | "availability"
  | "time-off"
  | "time-off-detail"
  | "time-off-form"
  | "profile";

const SCREENS: (SwitcherOption & { id: Screen })[] = [
  { id: "sessions", label: "My sessions (Tutor)" },
  { id: "session", label: "Session details" },
  { id: "availability", label: "My availability (Tutor)" },
  { id: "time-off", label: "Time off" },
  { id: "time-off-detail", label: "Time off details" },
  { id: "time-off-form", label: "Request / Add time off" },
  { id: "profile", label: "Profile (Manager)" },
];

const ROLES: SwitcherOption[] = [
  { id: "tutor", label: "Tutor" },
  { id: "manager", label: "Manager" },
  { id: "admin", label: "Admin" },
];

const STATES: (SwitcherOption & { id: DataState })[] = [
  { id: "populated", label: "Populated" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
];

const DEVICES: SwitcherOption[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
];

// What each detail screen opens with, per role.
const OPEN_TIME_OFF: Record<AreaRole, string> = { tutor: "to-5", manager: "to-2", admin: "to-1" };
// Office roles have no Session list in this area (a Manager's are on
// Bookings › Mine), so only the Tutor opens one.
const OPEN_SESSION: Record<AreaRole, string | null> = { tutor: "bk-an-1", manager: null, admin: null };

const TUTOR_ONLY: Screen[] = ["sessions", "session", "availability"];

function pickOption<T extends string>(options: SwitcherOption[], value: string | null): T {
  const match = options.find((option) => option.id === value) ?? options[0];
  // Every option id is a member of T by construction of each list.
  return match.id as T;
}

// Office roles have no Tutor pages; they land on the profile instead.
function resolveScreen(screen: Screen, role: AreaRole): Screen {
  return role !== "tutor" && TUTOR_ONLY.includes(screen) ? "profile" : screen;
}

const NAV_SCREEN: Partial<Record<NavId, Screen>> = {
  "my-sessions": "sessions",
  "my-availability": "availability",
  "time-off": "time-off",
  profile: "profile",
};

const SCREEN_NAV: Record<Screen, NavId> = {
  sessions: "my-sessions",
  session: "my-sessions",
  availability: "my-availability",
  "time-off": "time-off",
  "time-off-detail": "time-off",
  "time-off-form": "time-off",
  profile: "profile",
};

export default function TutorTimeOffPrototype(): ReactNode {
  const [params] = useSearchParams();
  const role = pickOption<AreaRole>(ROLES, params.get("role"));
  const state = pickOption<DataState>(STATES, params.get("state"));
  const theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
  const isPhone = params.get("device") === "phone";

  return (
    <>
      <DeviceFrame theme={theme} isPhone={isPhone}>
        {/* Keyed so a role or state switch starts the fake data over. */}
        <AreaApp key={`${role}-${state}`} role={role} state={state} />
      </DeviceFrame>
      <PrototypeSwitcher
        position="bottom"
        screens={SCREENS}
        toggles={[
          { param: "role", label: "Role", options: ROLES },
          { param: "state", label: "State", options: STATES },
          { param: "device", label: "Device", options: DEVICES },
        ]}
      />
    </>
  );
}

type AreaAppProps = { role: AreaRole; state: DataState };

function AreaApp({ role, state }: AreaAppProps): ReactNode {
  const [params, setParams] = useSearchParams();
  const requested = pickOption<Screen>(SCREENS, params.get("screen"));
  const screen = resolveScreen(requested, role);
  const store = useAreaStore(role, state === "empty");
  const load = useLoadPhase(state);
  const [elsewhere, setElsewhere] = useState<{ id: NavId; place: Elsewhere } | null>(null);
  const [openSessionId, setOpenSessionId] = useState<string | null>(
    requested === "session" ? OPEN_SESSION[role] : null,
  );
  // The switcher can jump to "session" without a remount; open it then.
  const [shownScreen, setShownScreen] = useState(requested);
  if (shownScreen !== requested) {
    setShownScreen(requested);
    if (requested === "session") setOpenSessionId(OPEN_SESSION[role]);
  }
  const openSession = store.bookings.find((booking) => booking.id === openSessionId) ?? null;
  const activeId = elsewhere?.id ?? SCREEN_NAV[screen];

  function showScreen(next: Screen): void {
    setElsewhere(null);
    setParams(
      (previous) => {
        const nextParams = new URLSearchParams(previous);
        nextParams.set("screen", next);
        return nextParams;
      },
      { replace: true },
    );
    document.querySelector("[data-kit-scroll]")?.scrollTo({ top: 0 });
  }

  function handleNavigate(id: NavId): void {
    const target = NAV_SCREEN[id];
    if (target) {
      showScreen(target);
      return;
    }
    const label = getNav(role).find((item) => item.id === id)?.label ?? id;
    const body =
      id === "bookings" && role === "manager"
        ? "Bookings › Mine lists every Booking you teach. It’s designed in the Bookings prototype."
        : `${label} is designed in its own prototype. This one covers the Tutor app, Time off and the profile.`;
    setElsewhere({ id, place: { title: label, body } });
  }

  const timeOffProps = {
    store,
    phase: load.phase,
    isRetrying: load.isRetrying,
    onRetry: load.retry,
    initialOpenId: screen === "time-off-detail" ? OPEN_TIME_OFF[role] : null,
    isFormInitiallyOpen: screen === "time-off-form",
  };
  const timeOff =
    role === "admin" ? <TimeOffQueueScreen {...timeOffProps} /> : <OwnTimeOffScreen {...timeOffProps} />;
  const sessions = (
    <MySessionsScreen
      me={store.me}
      phase={load.phase}
      isRetrying={load.isRetrying}
      onRetry={load.retry}
      sessions={store.bookings}
      onOpen={(session) => setOpenSessionId(session.id)}
    />
  );
  const screens: Record<Screen, ReactNode> = {
    sessions,
    session: sessions,
    availability: (
      <>
        <PageHeader
          title="My availability"
          description="When and where the bot can offer you to Guardians. Time off overrides it."
        />
        <AvailabilitySection
          phase={load.phase}
          isRetrying={load.isRetrying}
          onRetry={load.retry}
          rows={store.availability}
          onSave={store.saveAvailability}
        />
      </>
    ),
    "time-off": timeOff,
    "time-off-detail": timeOff,
    "time-off-form": timeOff,
    profile: (
      <ProfileScreen
        store={store}
        phase={load.phase}
        isRetrying={load.isRetrying}
        onRetry={load.retry}
      />
    ),
  };

  return (
    <AppShell
      name={CURRENT_USER[role].name}
      roleLabel={CURRENT_USER[role].role}
      // A Tutor has no badges (GET /api/counts is Office only).
      items={getNav(
        role,
        role !== "tutor" && load.phase === "ready" ? store.counts : null,
      )}
      activeId={activeId}
      onNavigate={handleNavigate}
    >
      <div key={elsewhere ? elsewhere.id : screen} className="kit-fade">
        {elsewhere ? (
          <ElsewhereScreen place={elsewhere.place} onBack={() => setElsewhere(null)} />
        ) : (
          screens[screen]
        )}
      </div>
      <SessionDetail
        session={openSession}
        me={store.me}
        backLabel={screen === "profile" ? "Your profile" : "My sessions"}
        onClose={() => setOpenSessionId(null)}
        onMarkCompleted={store.markCompleted}
      />
    </AppShell>
  );
}
