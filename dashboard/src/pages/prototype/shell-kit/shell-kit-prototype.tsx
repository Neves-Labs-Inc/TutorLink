// Plan: the shared shell and component kit for the dashboard redesign
// (TutorLink#191), in Faithful pastel. Throwaway, DEV-only, mock data.
// Route /prototype/shell-kit, driven by the floating switcher:
//   ?screen=shell|buttons|inputs|badges|lists|overlays|states|header
//   ?role=admin|manager|tutor    which nav and sample pages
//   ?theme=light|dark
//   ?device=desktop|phone        phone frames the page at 390×844
//   ?variant=A|B                 forks, decided 2026-10-13: A everywhere.
//     lists:    A table → rows (chosen) · B rich rows everywhere
//     overlays: phone details as A pushed page (chosen) · B bottom sheet
//     B stays reachable by typing ?variant=B, for the archive branch; the
//     switcher no longer shows the arrows.
// Later area prototypes import from ./kit (tokens, kit-root, components,
// overlays, shell, states); ./screens is this page's own demo content.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "@/components/shared/PrototypeSwitcher";
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";
import KitRoot from "@/pages/prototype/shell-kit/kit/kit-root";
import type { Role } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Theme } from "@/pages/prototype/shell-kit/kit/tokens";
import BadgesScreen from "@/pages/prototype/shell-kit/screens/badges-screen";
import ButtonsScreen from "@/pages/prototype/shell-kit/screens/buttons-screen";
import HeaderScreen from "@/pages/prototype/shell-kit/screens/header-screen";
import InputsScreen from "@/pages/prototype/shell-kit/screens/inputs-screen";
import ListsScreen from "@/pages/prototype/shell-kit/screens/lists-screen";
import OverlaysScreen from "@/pages/prototype/shell-kit/screens/overlays-screen";
import ShellScreen from "@/pages/prototype/shell-kit/screens/shell-screen";
import StatesScreen from "@/pages/prototype/shell-kit/screens/states-screen";

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
// Below this the window is already phone-sized, so no frame.
const FRAME_MIN_WIDTH = 640;
// Room around the frame: a margin on top, the switcher below.
const FRAME_CHROME_PX = 96;

const SCREENS: SwitcherOption[] = [
  { id: "shell", label: "Shell" },
  { id: "buttons", label: "Buttons" },
  { id: "inputs", label: "Inputs" },
  { id: "badges", label: "Badges" },
  { id: "lists", label: "Lists" },
  { id: "overlays", label: "Overlays" },
  { id: "states", label: "States" },
  { id: "header", label: "Header" },
];

const ROLES: SwitcherOption[] = [
  { id: "admin", label: "Admin" },
  { id: "manager", label: "Manager" },
  { id: "tutor", label: "Tutor" },
];

const DEVICES: SwitcherOption[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
];

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

// Shrinks the phone frame to fit short windows (laptops) without
// changing its 390px layout width.
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

function readRole(value: string | null): Role {
  return value === "manager" || value === "tutor" ? value : "admin";
}

function renderScreen(screen: string, role: Role, variant: string): ReactNode {
  const isB = variant === "B";
  const screens: Record<string, ReactNode> = {
    shell: <ShellScreen key={role} role={role} />,
    buttons: <ButtonsScreen />,
    inputs: <InputsScreen />,
    badges: <BadgesScreen />,
    lists: <ListsScreen role={role} variant={isB ? "B" : "A"} />,
    overlays: <OverlaysScreen phoneMode={isB ? "sheet" : "page"} />,
    states: <StatesScreen />,
    header: <HeaderScreen role={role} />,
  };
  return screens[screen] ?? screens.shell;
}

export default function ShellKitPrototype(): ReactNode {
  const [params] = useSearchParams();
  const isWide = useIsWide();
  const frameScale = useFrameScale();
  const screen = SCREENS.some((item) => item.id === params.get("screen"))
    ? (params.get("screen") ?? "shell")
    : "shell";
  const role = readRole(params.get("role"));
  const theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
  const variant = params.get("variant") === "B" ? "B" : "A";
  const isFramed = params.get("device") === "phone" && isWide;

  const content = renderScreen(screen, role, variant);
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
              {content}
            </KitRoot>
          </div>
        </div>
      ) : (
        <KitRoot theme={theme}>{content}</KitRoot>
      )}
      <PrototypeSwitcher
        position="bottom"
        screens={SCREENS}
        toggles={[
          { param: "role", label: "Role", options: ROLES },
          { param: "device", label: "Device", options: DEVICES },
        ]}
      />
    </>
  );
}
