// Sign in (/login): email and password in the brand frame. Field mistakes
// are caught before sending; a refusal shows one of three typed alerts.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { AuthFrame } from "@/components/kit/auth/auth-frame";
import {
  getEmailError,
  getSignInPasswordError,
} from "@/components/kit/auth/validation";
import { Button, TextLink } from "@/components/kit/components/button";
import { PasswordField, TextField } from "@/components/kit/components/fields";
import KitRoot from "@/components/kit/kit-root";
import { FormAlert } from "@/components/kit/states/states";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/use-theme";
import { landingPath } from "@/lib/auth/auth";
import { formatWait } from "@/lib/auth/sign-in";
import type { SignInFailure } from "@/lib/auth/sign-in";
import { useCountdown } from "@/pages/auth/hooks/use-countdown";

type FieldErrors = { email?: string; password?: string };

// The alert for a refusal that clears on edit; a lockout renders its own.
function renderFailureAlert(failure: SignInFailure | null): ReactNode {
  let alert: ReactNode = null;
  if (failure?.kind === "wrong") {
    alert = (
      <FormAlert tone="danger" title="That email and password don’t match">
        Check both and try again. Haven’t chosen a password yet? Use the link
        in your invite email.
      </FormAlert>
    );
  } else if (failure?.kind === "unreachable") {
    alert = (
      <FormAlert tone="danger" isOffline title="Couldn’t reach TutorLink">
        Check your connection and try again.
      </FormAlert>
    );
  }
  return alert;
}

export default function SignInPage(): ReactNode {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const { status, role, login, isLoggingIn, signInFailure } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isAlertDismissed, setIsAlertDismissed] = useState(false);
  const secondsLeft = useCountdown(
    signInFailure?.kind === "locked" ? signInFailure.lockout : null,
  );
  const isLocked = secondsLeft > 0;

  if (status === "authenticated" && role !== null) {
    return <Navigate to={landingPath(role)} replace />;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = {
      email: getEmailError(email),
      password: getSignInPasswordError(password),
    };
    setErrors(next);
    setHasSubmitted(true);
    if (next.email || next.password) return;
    setIsAlertDismissed(false);
    login(email.trim(), password);
  }

  // Before the first submit, leaving a field never scolds.
  function handleEmailBlur(): void {
    if (!hasSubmitted) return;
    setErrors((current) => ({ ...current, email: getEmailError(email) }));
  }

  function handlePasswordBlur(): void {
    if (!hasSubmitted) return;
    setErrors((current) => ({
      ...current,
      password: getSignInPasswordError(password),
    }));
  }

  const failureAlert = isAlertDismissed ? null : renderFailureAlert(signInFailure);

  return (
    <KitRoot theme={theme}>
      <AuthFrame
        title="Welcome back"
        body="Sign in to TutorLink with your work email."
        footer={
          <>
            <p>New here? Use the link in your invite email.</p>
            <p>Trouble signing in? Ask an Admin.</p>
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
            disabled={isLoggingIn}
            onBlur={handleEmailBlur}
            onChange={(event) => {
              setEmail(event.target.value);
              setIsAlertDismissed(true);
            }}
          />
          <div className="flex flex-col gap-1">
            <PasswordField
              label="Password"
              name="password"
              autoComplete="current-password"
              value={password}
              error={errors.password}
              disabled={isLoggingIn}
              onBlur={handlePasswordBlur}
              onChange={(event) => {
                setPassword(event.target.value);
                setIsAlertDismissed(true);
              }}
            />
            <div className="flex justify-end">
              <TextLink onClick={() => navigate("/forgot-password")}>
                Forgot password?
              </TextLink>
            </div>
          </div>
          {isLocked ? (
            <FormAlert tone="warning" title="Too many sign-in attempts">
              For your security, sign-in is paused. Try again in{" "}
              {/* role="alert" announces the alert once; the ticking count
                  must not re-announce it every minute. */}
              <span aria-live="off" className="font-semibold tabular-nums">
                {formatWait(secondsLeft)}
              </span>
              .
            </FormAlert>
          ) : (
            failureAlert
          )}
          <Button
            type="submit"
            variant="primary"
            isFullWidth
            isLoading={isLoggingIn}
            disabled={isLocked}
          >
            {isLoggingIn ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </AuthFrame>
    </KitRoot>
  );
}
