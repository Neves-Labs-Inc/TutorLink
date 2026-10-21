// Forgot password (/forgot-password): ask for the email, then the same
// "Check your email" answer whether or not an account exists.
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import { AuthFrame } from "@/components/kit/auth/auth-frame";
import { getEmailError } from "@/components/kit/auth/validation";
import { Button, TextLink } from "@/components/kit/components/button";
import { TextField } from "@/components/kit/components/fields";
import KitRoot from "@/components/kit/kit-root";
import { FormAlert } from "@/components/kit/states/states";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/use-theme";

// The API's reset-link lifetime.
const RESET_LINK_HOURS = 48;
const SIGN_IN_PATH = "/login";

export default function ForgotPasswordPage(): ReactNode {
  const { theme } = useTheme();
  const navigate = useNavigate();
  const {
    forgotPassword,
    isSendingReset,
    isResetSent,
    hasResetFailed,
    resetForgotPassword,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const shouldFocusEmailRef = useRef(false);

  // Runs after AuthFrame's own effect has focused the new h1, so "send
  // another link" lands in the Email field instead.
  useEffect(() => {
    if (isResetSent || !shouldFocusEmailRef.current) return;
    shouldFocusEmailRef.current = false;
    const field = formRef.current?.elements.namedItem("email");
    if (field instanceof HTMLInputElement) field.focus();
  }, [isResetSent]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const error = getEmailError(email);
    setEmailError(error);
    setHasSubmitted(true);
    if (error) return;
    forgotPassword(email.trim());
  }

  function handleEmailBlur(): void {
    if (!hasSubmitted) return;
    setEmailError(getEmailError(email));
  }

  function handleSendAnother(): void {
    shouldFocusEmailRef.current = true;
    resetForgotPassword();
  }

  const goToSignIn = () => navigate(SIGN_IN_PATH);

  const content = isResetSent ? (
    <AuthFrame
      icon={MailCheck}
      tone="success"
      title="Check your email"
      body={
        <>
          If there’s an account for{" "}
          <span className="font-semibold text-(--tl-ink)">{email.trim()}</span>,
          we’ve sent it a link to choose a new password. The link works for{" "}
          {RESET_LINK_HOURS} hours.
        </>
      }
      footer={
        <p>
          Nothing after a few minutes? Check your spam folder, or{" "}
          <TextLink onClick={handleSendAnother}>send another link</TextLink>.
        </p>
      }
    >
      <Button variant="primary" isFullWidth onClick={goToSignIn}>
        Back to sign in
      </Button>
    </AuthFrame>
  ) : (
    <AuthFrame
      title="Forgot your password?"
      body="Enter the email you sign in with and we’ll send you a link to choose a new one."
      footer={
        <TextLink onClick={goToSignIn}>
          <ArrowLeft aria-hidden className="size-4" />
          Back to sign in
        </TextLink>
      }
    >
      <form
        ref={formRef}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        <TextField
          label="Email"
          type="email"
          name="email"
          icon={Mail}
          autoComplete="username"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          error={emailError}
          disabled={isSendingReset}
          onBlur={handleEmailBlur}
          onChange={(event) => setEmail(event.target.value)}
        />
        {hasResetFailed && (
          <FormAlert tone="danger" isOffline title="Couldn’t reach TutorLink">
            Check your connection and try again.
          </FormAlert>
        )}
        <Button
          type="submit"
          variant="primary"
          isFullWidth
          isLoading={isSendingReset}
        >
          {isSendingReset ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthFrame>
  );

  return <KitRoot theme={theme}>{content}</KitRoot>;
}
