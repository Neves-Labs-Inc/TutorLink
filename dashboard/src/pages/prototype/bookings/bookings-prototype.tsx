// Plan: the Office Bookings area (TutorLink#193) on the approved shell
// kit, in Faithful pastel. Throwaway, DEV-only, mock data in the API's
// wire shapes (PR #224). Route /prototype/bookings, driven by the
// floating switcher:
//   ?screen=list|calendar|day|needs-attention|detail|new|new-eval|change|cancel
//          |new-assigned|new-not-assigned|new-no-tutors (TutorLink#243)
//   ?role=admin|manager
//   ?state=ready|loading|error|empty
//   ?device=desktop|phone        phone frames the page at 390×844
//   ?theme=light|dark
// Every screen is a starting point; the page stays live from there
// (open rows, change filters, book, cancel, mark Completed).
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "@/components/shared/PrototypeSwitcher";
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";
import KitRoot from "@/pages/prototype/shell-kit/kit/kit-root";
import type { Theme } from "@/pages/prototype/shell-kit/kit/tokens";
import BookingsPage from "@/pages/prototype/bookings/components/bookings-page";
import type {
  DataState,
  OfficeRole,
  Screen,
} from "@/pages/prototype/bookings/hooks/use-bookings-page";

const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 844;
const FRAME_MIN_WIDTH = 640;
const FRAME_CHROME_PX = 96;

const SCREENS: (SwitcherOption & { id: Screen })[] = [
  { id: "list", label: "List" },
  { id: "calendar", label: "Calendar · week" },
  { id: "day", label: "Calendar · day" },
  { id: "needs-attention", label: "Needs attention filter" },
  { id: "detail", label: "Detail (Staff is off)" },
  { id: "new", label: "New booking" },
  { id: "new-eval", label: "Book evaluation" },
  { id: "new-assigned", label: "New booking · Assigned Tutors first" },
  { id: "new-not-assigned", label: "New booking · not an Assigned Tutor" },
  { id: "new-no-tutors", label: "New booking · Child has no Tutors" },
  { id: "change", label: "Change booking" },
  { id: "cancel", label: "Cancel booking" },
];

const ROLES: SwitcherOption[] = [
  { id: "admin", label: "Admin" },
  { id: "manager", label: "Manager" },
];

const STATES: (SwitcherOption & { id: DataState })[] = [
  { id: "ready", label: "Loaded" },
  { id: "loading", label: "Loading" },
  { id: "error", label: "Error" },
  { id: "empty", label: "Empty" },
];

const DEVICES: SwitcherOption[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
];

function useMatchesMedia(query: string): boolean {
  const [isMatch, setIsMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = (): void => setIsMatch(media.matches);
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [query]);
  return isMatch;
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

function pick<T extends string>(options: { id: T }[], value: string | null): T {
  return options.find((option) => option.id === value)?.id ?? options[0].id;
}

export default function BookingsPrototype(): ReactNode {
  const [params] = useSearchParams();
  const isWide = useMatchesMedia(`(min-width: ${FRAME_MIN_WIDTH}px)`);
  const frameScale = useFrameScale();
  const screen = pick(SCREENS, params.get("screen"));
  const role: OfficeRole = params.get("role") === "manager" ? "manager" : "admin";
  const dataState = pick(STATES, params.get("state"));
  const theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
  const isFramed = params.get("device") === "phone" && isWide;

  // Remount on every switch so each screen starts from its own state.
  const content = (
    <BookingsPage
      key={`${screen}-${role}-${dataState}`}
      role={role}
      screen={screen}
      dataState={dataState}
    />
  );

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
          { param: "state", label: "Data", options: STATES },
          { param: "device", label: "Device", options: DEVICES },
        ]}
      />
    </>
  );
}
