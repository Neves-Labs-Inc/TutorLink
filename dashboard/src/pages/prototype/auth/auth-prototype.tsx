// Plan: the auth pages (TutorLink#198) under Faithful pastel, outside the
// app shell, in the brand panel frame (variant B, picked by Franklin),
// on one throwaway DEV-only route, /prototype/auth. Mock data is shaped
// as the /auth wire types (api/app/schemas/auth.py).
//   ?screen=login|forgot|invite|reset|dead-link|splash|not-found
//   ?state=…                   per screen; the switcher lists them
//   ?theme=light|dark
//   ?device=desktop|phone      phone frames the page at 390×844
// Links and submits work: a submit always succeeds after a short delay;
// the failure states are picked from the switcher.
import { useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "@/components/shared/PrototypeSwitcher";
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";
import { DeviceFrame } from "@/pages/prototype/shared/device-frame";
import type { Theme } from "@/components/kit/tokens";
import DeadLinkScreen from "@/pages/prototype/auth/components/screens/dead-link-screen";
import ForgotPasswordScreen from "@/pages/prototype/auth/components/screens/forgot-password-screen";
import LoginScreen from "@/pages/prototype/auth/components/screens/login-screen";
import NotFoundScreen from "@/pages/prototype/auth/components/screens/not-found-screen";
import SetPasswordScreen from "@/pages/prototype/auth/components/screens/set-password-screen";
import SignedInScreen from "@/pages/prototype/auth/components/screens/signed-in-screen";
import SplashScreen from "@/pages/prototype/auth/components/screens/splash-screen";
import { pickOption, SCREENS, STATES_BY_SCREEN } from "@/pages/prototype/auth/lib/scenarios";
import type {
  DeadLinkState,
  ForgotState,
  LoginState,
  ScreenId,
  SetPasswordState,
  SignedInFrom,
} from "@/pages/prototype/auth/lib/scenarios";

const DEVICES: SwitcherOption[] = [
  { id: "desktop", label: "Desktop" },
  { id: "phone", label: "Phone" },
];

export default function AuthPrototype(): ReactNode {
  const [params] = useSearchParams();
  const screen = pickOption<ScreenId>(SCREENS, params.get("screen"));
  const states = STATES_BY_SCREEN[screen];
  const state = pickOption<string>(states, params.get("state"));
  const theme: Theme = params.get("theme") === "dark" ? "dark" : "light";
  const isPhone = params.get("device") === "phone";

  return (
    <>
      <DeviceFrame theme={theme} isPhone={isPhone}>
        {/* Keyed so a screen or state switch starts the form over. */}
        <AuthScreens key={`${screen}-${state}`} screen={screen} state={state} />
      </DeviceFrame>
      <PrototypeSwitcher
        position="bottom"
        screens={SCREENS}
        toggles={[
          ...(states.length > 1
            ? [{ param: "state", label: "State", options: states }]
            : []),
          { param: "device", label: "Device", options: DEVICES },
        ]}
      />
    </>
  );
}

type AuthScreensProps = { screen: ScreenId; state: string };

// `state` was picked from this screen's own option list, so each cast
// below names a member of that screen's state union.
function AuthScreens({ screen, state }: AuthScreensProps): ReactNode {
  const [, setParams] = useSearchParams();
  const [signedInFrom, setSignedInFrom] = useState<SignedInFrom | null>(null);

  function handleGo(next: ScreenId, nextState?: string): void {
    setParams(
      (previous) => {
        const nextParams = new URLSearchParams(previous);
        nextParams.set("screen", next);
        if (nextState) nextParams.set("state", nextState);
        else nextParams.delete("state");
        return nextParams;
      },
      { replace: true },
    );
    document.querySelector("[data-kit-scroll]")?.scrollTo({ top: 0 });
  }

  if (signedInFrom !== null) {
    return (
      <div className="kit-fade min-h-full">
        <SignedInScreen from={signedInFrom} onRestart={() => setSignedInFrom(null)} />
      </div>
    );
  }

  const screens: Record<ScreenId, ReactNode> = {
    login: (
      <LoginScreen
        state={state as LoginState}
        onGo={handleGo}
        onSignedIn={() => setSignedInFrom("login")}
      />
    ),
    forgot: <ForgotPasswordScreen state={state as ForgotState} onGo={handleGo} />,
    invite: (
      <SetPasswordScreen
        mode="invite"
        state={state as SetPasswordState}
        onGo={handleGo}
        onSignedIn={() => setSignedInFrom("invite")}
      />
    ),
    reset: (
      <SetPasswordScreen
        mode="reset"
        state={state as SetPasswordState}
        onGo={handleGo}
        onSignedIn={() => setSignedInFrom("reset")}
      />
    ),
    "dead-link": <DeadLinkScreen state={state as DeadLinkState} onGo={handleGo} />,
    splash: <SplashScreen />,
    "not-found": <NotFoundScreen onGo={handleGo} />,
  };

  return <div className="kit-fade min-h-full">{screens[screen]}</div>;
}
