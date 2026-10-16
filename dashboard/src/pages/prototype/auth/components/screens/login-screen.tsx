// Sign in (today's /login). Email and password, Forgot password, and the
// four ways it can fail: wrong details (401), locked out (429), offline,
// and arriving after the session ended.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button, TextLink } from "@/components/kit/components/button";
import { TextField } from "@/components/kit/components/fields";
import AuthPage from "@/pages/prototype/auth/components/layout/auth-page";
import FormAlert from "@/pages/prototype/auth/components/form-alert";
import PasswordField from "@/pages/prototype/auth/components/password-field";
import PrototypeNote from "@/pages/prototype/auth/components/prototype-note";
import WireNote from "@/pages/prototype/auth/components/wire-note";
import { formatWait, useCountdown } from "@/pages/prototype/auth/hooks/use-countdown";
import { useMockSubmit } from "@/pages/prototype/auth/hooks/use-mock-submit";
import {
  MOCK_EMAIL,
  MOCK_RETRY_AFTER_SECONDS,
  WIRE,
} from "@/pages/prototype/auth/lib/mock-auth-api";
import type { WireExchange } from "@/pages/prototype/auth/lib/mock-auth-api";
import type { GoTo, LoginState } from "@/pages/prototype/auth/lib/scenarios";
import {
  getEmailError,
  getSignInPasswordError,
} from "@/pages/prototype/auth/lib/validation";

const WIRE_BY_STATE: Record<LoginState, WireExchange | null> = {
  ready: WIRE.loginOk,
  submitting: WIRE.loginOk,
  wrong: WIRE.loginWrong,
  locked: WIRE.loginLocked,
  offline: WIRE.loginOffline,
  "signed-out": null,
};

type FieldErrors = { email?: string; password?: string };

type LoginScreenProps = {
  state: LoginState;
  onGo: GoTo;
  onSignedIn: () => void;
};

export default function LoginScreen({
  state,
  onGo,
  onSignedIn,
}: LoginScreenProps): ReactNode {
  const isPrefilled = state !== "ready" && state !== "signed-out";
  const [email, setEmail] = useState(isPrefilled ? MOCK_EMAIL : "");
  const [password, setPassword] = useState(isPrefilled ? "sunflower-42" : "");
  const [errors, setErrors] = useState<FieldErrors>({});
  // A server message stays until the person edits the form, as today.
  const [isAlertDismissed, setIsAlertDismissed] = useState(false);
  const secondsLeft = useCountdown(state === "locked" ? MOCK_RETRY_AFTER_SECONDS : 0);
  const { isSubmitting, submit } = useMockSubmit(state === "submitting", onSignedIn);
  const isLocked = secondsLeft > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = {
      email: getEmailError(email),
      password: getSignInPasswordError(password),
    };
    setErrors(next);
    if (next.email || next.password) return;
    void submit();
  }

  function handleEdit(): void {
    setIsAlertDismissed(true);
  }

  const alerts: Partial<Record<LoginState, ReactNode>> = {
    wrong: (
      <FormAlert tone="danger" title="That email and password don't match">
        Check both and try again. Haven&rsquo;t chosen a password yet? Use the
        link in your invite email.
      </FormAlert>
    ),
    offline: (
      <FormAlert tone="danger" isOffline title="Couldn't reach TutorLink">
        Check your connection and try again.
      </FormAlert>
    ),
    "signed-out": (
      <FormAlert tone="info" title="You were signed out">
        Your session ended. Sign in again to carry on.
      </FormAlert>
    ),
  };
  const alert = isAlertDismissed ? null : alerts[state];

  return (
    <AuthPage
      title="Welcome back"
      body="Sign in to TutorLink with your work email."
      footer={
        <>
          <p>New here? Use the link in your invite email.</p>
          <p>Trouble signing in? Ask an Admin.</p>
        </>
      }
      notes={
        <>
          {state === "ready" && (
            <PrototypeNote>
              Social sign-in, 2FA and passkeys are out of scope; they would sit
              under the Sign in button later.
            </PrototypeNote>
          )}
          {state === "wrong" && (
            <PrototypeNote>
              Archived Staff and Staff who never chose a password get this same
              401 on purpose, so the page can&rsquo;t reveal which accounts
              exist.
            </PrototypeNote>
          )}
          {state === "locked" && (
            <PrototypeNote>
              The wait comes from the 429&rsquo;s Retry-After (the dashboard
              ignores it today). The copy never says whether the email or the
              network tripped the limit.
            </PrototypeNote>
          )}
          {state === "signed-out" && (
            <PrototypeNote kind="question">
              Should sign-in say why you&rsquo;re here (session expired, or you
              signed out)? Today it says nothing. The redirect would pass the
              reason; no API work.
            </PrototypeNote>
          )}
          <WireNote exchange={WIRE_BY_STATE[state]} />
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          error={errors.email}
          disabled={isSubmitting}
          onChange={(event) => {
            setEmail(event.target.value);
            handleEdit();
          }}
        />
        <div className="flex flex-col gap-1">
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            value={password}
            error={errors.password}
            disabled={isSubmitting}
            onChange={(event) => {
              setPassword(event.target.value);
              handleEdit();
            }}
          />
          <div className="flex justify-end">
            <TextLink onClick={() => onGo("forgot")}>Forgot password?</TextLink>
          </div>
        </div>
        {isLocked ? (
          <FormAlert tone="warning" title="Too many sign-in attempts">
            For your security, sign-in is paused. Try again in{" "}
            <span className="font-semibold tabular-nums">
              {formatWait(secondsLeft)}
            </span>
            .
          </FormAlert>
        ) : (
          alert
        )}
        <Button
          type="submit"
          variant="primary"
          isFullWidth
          isLoading={isSubmitting}
          disabled={isLocked}
        >
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthPage>
  );
}
