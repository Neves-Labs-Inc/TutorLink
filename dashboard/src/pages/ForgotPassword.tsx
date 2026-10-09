import { useState, type FormEvent, type ReactNode } from "react";

import AuthCard from "@/components/auth/AuthCard";
import { DISABLED_INPUT, EMAIL_PATTERN, FADE_IN, SUBMIT_BUTTON } from "@/components/auth/authStyles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";

const CONFIRMATION_FALLBACK =
  "If an account exists for that email, we sent a link to reset the password.";

function validateEmail(email: string): string | null {
  if (!email) return "Enter your email address.";
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address.";
  return null;
}

export default function ForgotPassword(): ReactNode {
  const { forgotPassword, isSendingReset, forgotPasswordConfirmation, forgotPasswordError } =
    useAuth();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isErrorDismissed, setIsErrorDismissed] = useState(false);

  const formError = isErrorDismissed ? null : forgotPasswordError;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const error = validateEmail(email.trim());
    setEmailError(error);
    if (error !== null) return;

    setIsErrorDismissed(false);
    forgotPassword(email.trim());
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter your email and we'll send you a link to choose a new one."
    >
      {forgotPasswordConfirmation !== null ? (
        <p role="status" className={`text-sm text-foreground ${FADE_IN}`}>
          {forgotPasswordConfirmation || CONFIRMATION_FALLBACK}
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              value={email}
              disabled={isSendingReset}
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailError ? "email-error" : undefined}
              onChange={(event) => {
                setEmail(event.target.value);
                setIsErrorDismissed(true);
              }}
              className={`h-10 ${DISABLED_INPUT}`}
            />
            {emailError && (
              <p id="email-error" role="alert" className="text-sm font-medium text-destructive">
                {emailError}
              </p>
            )}
          </div>

          {formError && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {formError}
            </p>
          )}

          <Button type="submit" disabled={isSendingReset} className={SUBMIT_BUTTON}>
            {isSendingReset ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
