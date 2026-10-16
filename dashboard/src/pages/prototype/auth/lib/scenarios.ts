// Screens and the states each one can show, as switcher options.
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";

export type ScreenId =
  | "login"
  | "forgot"
  | "invite"
  | "reset"
  | "dead-link"
  | "splash"
  | "not-found";

export const SCREENS: SwitcherOption[] = [
  { id: "login", label: "Sign in" },
  { id: "forgot", label: "Forgot password" },
  { id: "invite", label: "Invite: first password" },
  { id: "reset", label: "Reset: new password" },
  { id: "dead-link", label: "Expired or used link" },
  { id: "splash", label: "Checking session" },
  { id: "not-found", label: "Page not found" },
];

export type LoginState =
  | "ready"
  | "submitting"
  | "wrong"
  | "locked"
  | "offline"
  | "signed-out";

export type ForgotState = "ready" | "sending" | "sent" | "offline";

export type SetPasswordState =
  | "ready"
  | "submitting"
  | "mismatch"
  | "too-long"
  | "offline";

export type DeadLinkState = "unknown" | "invite" | "reset";

const SET_PASSWORD_STATES: SwitcherOption[] = [
  { id: "ready", label: "Ready" },
  { id: "submitting", label: "Saving" },
  { id: "mismatch", label: "Don't match" },
  { id: "too-long", label: "Too long (422)" },
  { id: "offline", label: "Offline" },
];

export const STATES_BY_SCREEN: Record<ScreenId, SwitcherOption[]> = {
  login: [
    { id: "ready", label: "Ready" },
    { id: "submitting", label: "Signing in" },
    { id: "wrong", label: "Wrong (401)" },
    { id: "locked", label: "Locked (429)" },
    { id: "offline", label: "Offline" },
    { id: "signed-out", label: "Session ended" },
  ],
  forgot: [
    { id: "ready", label: "Ready" },
    { id: "sending", label: "Sending" },
    { id: "sent", label: "Sent (202)" },
    { id: "offline", label: "Offline" },
  ],
  invite: SET_PASSWORD_STATES,
  reset: SET_PASSWORD_STATES,
  "dead-link": [
    { id: "unknown", label: "Today: kind unknown" },
    { id: "invite", label: "Invite" },
    { id: "reset", label: "Reset" },
  ],
  splash: [{ id: "default", label: "Loading" }],
  "not-found": [{ id: "default", label: "Default" }],
};

// Moves the prototype to another screen, as a link in the real app would.
export type GoTo = (screen: ScreenId, state?: string) => void;

export type SignedInFrom = "login" | "invite" | "reset";

export function pickOption<T extends string>(
  options: SwitcherOption[],
  value: string | null,
): T {
  const match = options.find((option) => option.id === value) ?? options[0];
  // Every option id is a member of T by construction of each list.
  return match.id as T;
}
