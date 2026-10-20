// Plan: the Chats area for the dashboard redesign (TutorLink#194), on the
// shared kit (components/kit). Throwaway, DEV-only, mock data in the real
// API shapes (types/api.ts). Route /prototype/chats, driven by the
// floating switcher:
//   ?screen=   conversations | chat-bot | chat-mine | chat-other |
//              chat-closed | chat-mine-closed | chat-reactivation |
//              chat-new | reminders | reminders-sent | reminders-off |
//              reminders-not-set-up
//   ?role=     admin | manager
//   ?state=    populated | loading | empty | error
//   ?device=   desktop | phone   (phone frames the page at 390×844)
//   ?theme=    light | dark
// Dashed fuchsia "?" markers flag guesses: open flow questions and
// fields the API doesn't send yet. Hover them.
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "@/components/shared/PrototypeSwitcher";
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";
import { AppShell } from "@/components/kit/shell/app-shell";
import { CURRENT_USER } from "@/pages/prototype/shared/mock-data";
import { getMockNav } from "@/pages/prototype/shared/mock-nav";
import type { NavId } from "@/components/kit/shell/nav";
import { useToast } from "@/components/kit/overlays/use-toast";
import type { Theme } from "@/components/kit/tokens";
import { OFFICE_USERS } from "@/pages/prototype/chats/mock/chats-mock";
import {
  LAST_WEEK_START,
  NEXT_WEEK_START,
} from "@/pages/prototype/chats/mock/reminders-mock";
import type { RemindersState } from "@/pages/prototype/chats/types/api";
import { useChats } from "@/pages/prototype/chats/hooks/use-chats";
import ChatsPage from "@/pages/prototype/chats/components/chats-page";
import type {
  ChatsTab,
  DataState,
} from "@/pages/prototype/chats/components/chats-page";
import DeviceFrame from "@/pages/prototype/chats/components/device-frame";

type OfficeRole = "admin" | "manager";

type ScreenSetup = {
  tab: ChatsTab;
  openId: string | null;
  week: string;
  reminders: RemindersState;
};

const LIST: ScreenSetup = {
  tab: "conversations",
  openId: null,
  week: NEXT_WEEK_START,
  reminders: "on",
};

const SCREEN_SETUP: Record<string, ScreenSetup> = {
  conversations: LIST,
  "chat-bot": { ...LIST, openId: "c-laura" },
  "chat-mine": { ...LIST, openId: "c-patricia" },
  "chat-other": { ...LIST, openId: "c-ricardo" },
  "chat-closed": { ...LIST, openId: "c-roberto" },
  "chat-mine-closed": { ...LIST, openId: "c-jorge" },
  "chat-reactivation": { ...LIST, openId: "c-elena" },
  "chat-new": { ...LIST, openId: "c-new" },
  "chat-intake-failed": { ...LIST, openId: "c-diego" },
  reminders: { ...LIST, tab: "reminders" },
  "reminders-sent": { ...LIST, tab: "reminders", week: LAST_WEEK_START },
  "reminders-off": { ...LIST, tab: "reminders", reminders: "off" },
  "reminders-not-set-up": { ...LIST, tab: "reminders", reminders: "not_set_up" },
};

const SCREENS: SwitcherOption[] = [
  { id: "conversations", label: "Conversations" },
  { id: "chat-bot", label: "Chat · Bot, Wants to book" },
  { id: "chat-mine", label: "Chat · Taken over by you" },
  { id: "chat-other", label: "Chat · Taken over by a colleague" },
  { id: "chat-closed", label: "Chat · Window closed (Bot got stuck)" },
  { id: "chat-mine-closed", label: "Chat · Yours, window closed" },
  { id: "chat-reactivation", label: "Chat · Reactivation request" },
  { id: "chat-new", label: "Chat · Unnamed number, Intake in progress" },
  { id: "chat-intake-failed", label: "Chat · Intake, failed bot reply, handoff note" },
  { id: "reminders", label: "Reminders · coming week" },
  { id: "reminders-sent", label: "Reminders · last week's run" },
  { id: "reminders-off", label: "Reminders · off" },
  { id: "reminders-not-set-up", label: "Reminders · not set up" },
];


const ROLES: SwitcherOption[] = [
  { id: "admin", label: "Admin" },
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

function pick<T extends string>(value: string | null, options: T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback;
}

export default function ChatsPrototype(): ReactNode {
  const [params] = useSearchParams();
  const screen = pick(params.get("screen"), Object.keys(SCREEN_SETUP), "conversations");
  const role = pick<OfficeRole>(params.get("role"), ["admin", "manager"], "admin");
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
        <ChatsScreen
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

type ChatsScreenProps = {
  role: OfficeRole;
  setup: ScreenSetup;
  dataState: DataState;
};

function ChatsScreen({ role, setup, dataState }: ChatsScreenProps): ReactNode {
  const { showToast } = useToast();
  const me = OFFICE_USERS[role];
  const colleague = OFFICE_USERS[role === "admin" ? "manager" : "admin"];
  const chats = useChats(me, colleague);

  function handleNavigate(id: NavId): void {
    if (id === "chats") return;
    showToast({ tone: "info", message: "Only Chats is in this prototype." });
  }

  return (
    <AppShell
      name={CURRENT_USER[role].name}
      roleLabel={CURRENT_USER[role].role}
      items={getMockNav(role)}
      activeId="chats"
      onNavigate={handleNavigate}
    >
      <ChatsPage
        role={role}
        chats={chats}
        meId={me.id}
        dataState={dataState}
        initialTab={setup.tab}
        initialOpenId={dataState === "empty" ? null : setup.openId}
        initialWeek={setup.week}
        remindersState={setup.reminders}
      />
    </AppShell>
  );
}
