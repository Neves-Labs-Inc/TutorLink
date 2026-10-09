import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import AuthCard from "@/components/auth/AuthCard";
import { DISABLED_INPUT, FADE_IN, SUBMIT_BUTTON } from "@/components/auth/authStyles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { setPasswordFormErrors, type SetPasswordFormErrors } from "@/lib/auth/auth";

const HTTP_BAD_REQUEST = 400;
const HTTP_UNPROCESSABLE = 422;
const GENERIC_ERROR = "Something went wrong. Please try again.";

function InvalidLinkBlock(): ReactNode {
  return (
    <div role="alert" className={`space-y-3 ${FADE_IN}`}>
      <p className="text-sm font-medium text-destructive">This link is invalid or has expired.</p>
      <p className="text-sm text-muted-foreground">
        <Link
          to="/forgot-password"
          className="relative font-medium text-primary underline-offset-4 before:absolute before:-inset-x-2 before:-inset-y-3.5 md:before:hidden hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Request a new reset link
        </Link>{" "}
        or ask an Admin for a new invite.
      </p>
    </div>
  );
}

export default function SetPassword(): ReactNode {
  const [searchParams, setSearchParams] = useSearchParams();
  // Read once into state so the secret can leave the address bar (history, referrers) at once.
  const [token] = useState(() => searchParams.get("token"));

  useEffect(() => {
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const { setPasswordWithToken, isSettingPassword, setPasswordFailure } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<SetPasswordFormErrors>({});
  const [isFailureDismissed, setIsFailureDismissed] = useState(false);

  const failure = isFailureDismissed ? null : setPasswordFailure;
  const isLinkDead = !token || failure?.status === HTTP_BAD_REQUEST;
  const isBadPassword = failure?.status === HTTP_UNPROCESSABLE;
  const passwordError = errors.password ?? (isBadPassword ? failure.detail : undefined);
  const formError = failure && !isBadPassword ? GENERIC_ERROR : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    const nextErrors = setPasswordFormErrors(password, confirm);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setIsFailureDismissed(false);
    setPasswordWithToken(token, password);
  }

  return (
    <AuthCard title="Set your password" description="Choose a password of at least 8 characters.">
      {isLinkDead ? (
        <InvalidLinkBlock />
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              disabled={isSettingPassword}
              aria-invalid={Boolean(passwordError)}
              aria-describedby={passwordError ? "password-error" : undefined}
              onChange={(event) => {
                setPassword(event.target.value);
                setIsFailureDismissed(true);
              }}
              className={`h-10 ${DISABLED_INPUT}`}
            />
            {passwordError && (
              <p id="password-error" role="alert" className="text-sm font-medium text-destructive">
                {passwordError}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              disabled={isSettingPassword}
              aria-invalid={Boolean(errors.confirm)}
              aria-describedby={errors.confirm ? "confirm-error" : undefined}
              onChange={(event) => setConfirm(event.target.value)}
              className={`h-10 ${DISABLED_INPUT}`}
            />
            {errors.confirm && (
              <p id="confirm-error" role="alert" className="text-sm font-medium text-destructive">
                {errors.confirm}
              </p>
            )}
          </div>

          {formError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {formError}
            </p>
          )}

          <Button type="submit" disabled={isSettingPassword} className={SUBMIT_BUTTON}>
            {isSettingPassword ? "Setting password…" : "Set password"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
