// Plan: Home and its To do queue for Admins and Managers (TutorLink#192),
// on the approved shell kit. Throwaway, DEV-only, mock data shaped as
// the API's wire types. Route /prototype/home, driven by the switcher:
//   ?screen=home|chats|time-off   Home, or where each "See all" lands
//          |needs-tutor           Home with a Needs a Tutor Child open
//                                 (Assigned Tutors, TutorLink#243)
//   ?role=admin|manager
//   ?state=populated|loading|empty|error|stale
//   ?theme=light|dark
//   ?device=desktop|phone        phone frames the page at 390×844
// The nav works too: Chats and Time off go to the See all screens; other
// items land on a "designed in another prototype" stand-in.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "@/components/shared/PrototypeSwitcher";
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";
import KitRoot from "@/pages/prototype/shell-kit/kit/kit-root";
import { getNav } from "@/pages/prototype/shell-kit/kit/shell/nav";
import type { NavId } from "@/pages/prototype/shell-kit/kit/shell/nav";
import type { Theme } from "@/pages/prototype/shell-kit/kit/tokens";
import ChatsSeeAll from "@/pages/prototype/home/components/chats-see-all";
import ElsewhereScreen from "@/pages/prototype/home/components/elsewhere-screen";
import type { Elsewhere } from "@/pages/prototype/home/components/elsewhere-screen";
import HomeScreen from "@/pages/prototype/home/components/home-screen";
import HomeShell from "@/pages/prototype/home/components/home-shell";
import TimeOffSeeAll from "@/pages/prototype/home/components/time-off-see-all";
import { useHomeData } from "@/pages/prototype/home/hooks/use-home-data";
import type { HomeState } from "@/pages/prototype/home/hooks/use-home-data";
import type { OfficeRole } from "@/pages/prototype/home/lib/mock-api";
import { getDisplayName } from "@/pages/prototype/home/lib/labels";
import type { ConversationSummary } from "@/pages/prototype/home/types/api";

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
// Below this the window is already phone-sized, so no frame.
const FRAME_MIN_WIDTH = 640;
// Room around the frame: a margin on top, the switcher below.
const FRAME_CHROME_PX = 96;

type Screen = "home" | "needs-tutor" | "chats" | "time-off";

const SCREENS: SwitcherOption[] = [
  { id: "home", label: "Home" },
  { id: "needs-tutor", label: "Home › Needs a Tutor (Child)" },
  { id: "chats", label: "See all: Chats" },
  { id: "time-off", label: "See all: Time off" },
];

const ROLES: SwitcherOption[] = [
  { id: "admin", label: "Admin" },
  { id: "manager", label: "Manager" },
];

const STATES: SwitcherOption[] = [
  { id: "populated", label: "Populated" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
  { id: "stale", label: "Refresh failed" },
];

const DEVICES: SwitcherOption[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
];

function pickOption<T extends string>(options: SwitcherOption[], value: string | null): T {
  const match = options.find((option) => option.id === value) ?? options[0];
  // Every option id is a member of T by construction of each list.
  return match.id as T;
}

function useIsWide(): boolean {
  const query = `(min-width: ${FRAME_MIN_WIDTH}px)`;
  const [isWide, setIsWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = (): void => setIsWide(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [query]);
  return isWide;
}

// Shrinks the phone frame to fit short windows without changing its
// 390px layout width.
function useFrameScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    function handleResize(): void {
      setScale(Math.min(1, (window.innerHeight - FRAME_CHROME_PX) / PHONE_HEIGHT));
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  return scale;
}

export default function HomePrototype(): ReactNode {
  const [params] = useSearchParams();
  const isWide = useIsWide();
  const frameScale = useFrameScale();
  const role = pickOption<OfficeRole>(ROLES, params.get("role"));
  const state = pickOption<HomeState>(STATES, params.get("state"));
  const theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
  const isFramed = params.get("device") === "phone" && isWide;

  // Keyed so a role or state switch starts the fake data over.
  const app = <HomeApp key={`${role}-${state}`} role={role} state={state} />;
  return (
    <>
      {isFramed ? (
        <div className="flex h-dvh items-start justify-center overflow-hidden bg-neutral-300 pt-4">
          <div
            className="shrink-0 origin-top overflow-hidden rounded-[44px] shadow-2xl ring-[10px] ring-neutral-800"
            style={{
              width: PHONE_WIDTH,
              height: PHONE_HEIGHT,
              transform: frameScale < 1 ? `scale(${frameScale})` : undefined,
            }}
          >
            <KitRoot theme={theme} height={`${PHONE_HEIGHT}px`}>
              {app}
            </KitRoot>
          </div>
        </div>
      ) : (
        <KitRoot theme={theme}>{app}</KitRoot>
      )}
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

type HomeAppProps = { role: OfficeRole; state: HomeState };

function HomeApp({ role, state }: HomeAppProps): ReactNode {
  const [params, setParams] = useSearchParams();
  const [elsewhere, setElsewhere] = useState<Elsewhere | null>(null);
  const [elsewhereId, setElsewhereId] = useState<NavId | null>(null);
  const api = useHomeData(role, state);
  const screen = pickOption<Screen>(SCREENS, params.get("screen"));
  const activeId: NavId = elsewhereId ?? (screen === "needs-tutor" ? "home" : screen);

  function showScreen(next: Screen): void {
    setElsewhere(null);
    setElsewhereId(null);
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
    if (id === "home" || id === "chats" || id === "time-off") {
      showScreen(id);
      return;
    }
    const label =
      getNav(role).find((item) => item.id === id)?.label ?? "Your profile";
    setElsewhereId(id);
    setElsewhere({
      title: label,
      body: `${label} is designed in its own prototype. Home only links to it.`,
    });
  }

  function handleOpenChat(chat: ConversationSummary): void {
    setElsewhereId("chats");
    setElsewhere({
      title: `Chat with ${getDisplayName(chat)}`,
      body: "Tapping a To do chat opens that chat. The thread is designed in the Chats prototype.",
    });
  }

  function handleSeeAllBookings(): void {
    setElsewhereId("bookings");
    setElsewhere({
      title: "Bookings",
      body:
        role === "manager"
          ? "PLACEHOLDER: To do › Bookings “See all” lands on Bookings, filtered to Children with an Evaluation to book. That filtered view belongs to the Bookings prototype."
          : "PLACEHOLDER: To do › Bookings “See all” lands on Bookings, filtered to what To do lists: Bookings not marked, clashing with Time off or with archived Staff, and Evaluations to book. That filtered view belongs to the Bookings prototype.",
    });
  }

  const screens: Record<Screen, ReactNode> = {
    home: (
      <HomeScreen
        role={role}
        api={api}
        onNavigate={handleNavigate}
        onOpenChat={handleOpenChat}
        onSeeAllBookings={handleSeeAllBookings}
      />
    ),
    "needs-tutor": (
      <HomeScreen
        role={role}
        api={api}
        initialNeedsTutor
        onNavigate={handleNavigate}
        onOpenChat={handleOpenChat}
        onSeeAllBookings={handleSeeAllBookings}
      />
    ),
    chats: (
      <ChatsSeeAll role={role} api={api} onOpenChat={handleOpenChat} />
    ),
    "time-off": <TimeOffSeeAll role={role} api={api} />,
  };

  return (
    <HomeShell
      role={role}
      counts={api.phase === "ready" ? (api.data?.counts ?? null) : null}
      activeId={activeId}
      onNavigate={handleNavigate}
    >
      <div key={elsewhere ? elsewhere.title : screen} className="kit-fade">
        {elsewhere ? (
          <ElsewhereScreen place={elsewhere} onBackHome={() => showScreen("home")} />
        ) : (
          screens[screen]
        )}
      </div>
    </HomeShell>
  );
}
