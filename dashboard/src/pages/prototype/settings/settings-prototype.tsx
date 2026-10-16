// Plan: the Settings area for the dashboard redesign (TutorLink#196), on
// the shared kit (shell-kit/kit). Throwaway, DEV-only, mock data in the
// real API shapes (types/api.ts). Route /prototype/settings, driven by
// the floating switcher:
//   ?screen=  overview | unsaved | invalid | save-failed | retention |
//             leave | reminders-off | reminders-not-set-up |
//             timezone-unlocked | sign-in | email-invite |
//             email-preview | email-error
//   ?role=    admin | developer | manager
//   ?state=   populated | loading | empty | error
//   ?device=  desktop | phone   (phone frames the page at 390×844)
//   ?theme=   light | dark
// Dashed fuchsia "?" markers flag guesses: open flow questions and API
// gaps. Hover them.
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "@/components/shared/PrototypeSwitcher";
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";
import { DeviceFrame } from "@/pages/prototype/shell-kit/kit/device-frame";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import type { Theme } from "@/pages/prototype/shell-kit/kit/tokens";
import { getSettingsPage } from "@/pages/prototype/settings/mock/settings-mock";
import type { MockOptions } from "@/pages/prototype/settings/mock/settings-mock";
import { useSimulatedLoad } from "@/pages/prototype/settings/hooks/use-simulated-load";
import type { Load } from "@/pages/prototype/settings/hooks/use-simulated-load";
import SettingsPage from "@/pages/prototype/settings/components/settings-page";
import type { SettingsSetup } from "@/pages/prototype/settings/components/settings-page";
import SettingsStates from "@/pages/prototype/settings/components/settings-states";

type ScreenSetup = { mock?: Partial<MockOptions>; page?: SettingsSetup };

// An Invite body that breaks the rules: no {link}.
const BROKEN_INVITE_BODY =
  "Hi {name},\n\n{actor_name} has added you to TutorLink. Reply to this email to get started.\n\nThe TutorLink team";

const TWO_CHANGES = { session_length_minutes: "90", reminder_hour: "17" };

const SCREEN_SETUP: Record<string, ScreenSetup> = {
  overview: {},
  unsaved: { page: { initialDraft: TWO_CHANGES } },
  invalid: { page: { initialDraft: { session_gap_minutes: "-15", office_phone: "305 555 0142" } } },
  "save-failed": { page: { initialDraft: TWO_CHANGES, shouldSaveFail: true } },
  retention: { page: { initialDraft: { chat_retention_days: "90" }, dialog: "retention" } },
  leave: { page: { initialDraft: TWO_CHANGES, dialog: "leave" } },
  "reminders-off": { mock: { areRemindersEnabled: false } },
  "reminders-not-set-up": { mock: { isRemindersPaused: true } },
  "timezone-unlocked": { mock: { isTimezoneLocked: false } },
  "sign-in": { page: { isSignInOpen: true } },
  "email-invite": { page: { openTemplate: "invite" } },
  "email-preview": { page: { openTemplate: "invite", templateView: "preview" } },
  "email-error": { page: { openTemplate: "invite", templateBody: BROKEN_INVITE_BODY } },
};

const SCREENS: SwitcherOption[] = [
  { id: "overview", label: "Settings" },
  { id: "unsaved", label: "Unsaved changes" },
  { id: "invalid", label: "Invalid values" },
  { id: "save-failed", label: "Save fails (press Save)" },
  { id: "retention", label: "Confirm · shorter chat history" },
  { id: "leave", label: "Confirm · leave unsaved" },
  { id: "reminders-off", label: "Reminders · off" },
  { id: "reminders-not-set-up", label: "Reminders · not set up" },
  { id: "timezone-unlocked", label: "Time zone · before first Booking" },
  { id: "sign-in", label: "Sign-in protection open" },
  { id: "email-invite", label: "Email editor" },
  { id: "email-preview", label: "Email editor · preview" },
  { id: "email-error", label: "Email editor · missing link" },
];

const ROLES: SwitcherOption[] = [
  { id: "admin", label: "Admin" },
  { id: "developer", label: "Developer" },
  { id: "manager", label: "Manager" },
];

const STATES: SwitcherOption[] = [
  { id: "populated", label: "Data" },
  { id: "loading", label: "Loading" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
];

const DEVICES: SwitcherOption[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
];

type ViewerRole = "admin" | "developer" | "manager";
type DataState = "populated" | "loading" | "empty" | "error";

function pick<T extends string>(value: string | null, options: T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

export default function SettingsPrototype(): ReactNode {
  const [params] = useSearchParams();
  const screen = pick(params.get("screen"), Object.keys(SCREEN_SETUP), "overview");
  const role = pick<ViewerRole>(params.get("role"), ["admin", "developer", "manager"], "admin");
  const dataState = pick<DataState>(
    params.get("state"),
    ["populated", "loading", "empty", "error"],
    "populated",
  );
  const theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
  const isPhone = params.get("device") === "phone";

  return (
    <>
      <DeviceFrame theme={theme} isPhone={isPhone}>
        <SettingsScreen
          // A fresh mock per switch, so every screen starts as described.
          key={`${screen}-${role}-${dataState}`}
          role={role}
          setup={SCREEN_SETUP[screen]}
          dataState={dataState}
        />
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

type SettingsScreenProps = {
  role: ViewerRole;
  setup: ScreenSetup;
  dataState: DataState;
};

const INITIAL_LOAD: Record<DataState, Load> = {
  populated: "ready",
  empty: "ready",
  loading: "loading",
  error: "error",
};

function SettingsScreen({ role, setup, dataState }: SettingsScreenProps): ReactNode {
  const { showToast } = useToast();
  const [load, retry] = useSimulatedLoad(INITIAL_LOAD[dataState]);
  const isDeveloper = role === "developer";

  function handleNavigate(): void {
    showToast({ tone: "info", message: "Only Settings is in this prototype." });
  }

  if (role === "manager") {
    return <SettingsStates kind="manager" role="manager" onRetry={retry} onNavigate={handleNavigate} />;
  }
  if (load !== "ready") {
    return <SettingsStates kind={load} role="admin" onRetry={retry} onNavigate={handleNavigate} />;
  }
  if (dataState === "empty") {
    return <SettingsStates kind="empty" role="admin" onRetry={retry} onNavigate={handleNavigate} />;
  }

  const wire = getSettingsPage({
    isDeveloper,
    isTimezoneLocked: true,
    isRemindersPaused: false,
    areRemindersEnabled: true,
    ...setup.mock,
  });
  return <SettingsPage isDeveloper={isDeveloper} wire={wire} setup={setup.page ?? {}} />;
}
