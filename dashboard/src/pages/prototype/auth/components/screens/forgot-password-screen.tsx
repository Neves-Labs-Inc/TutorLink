// Forgot password (today's /forgot-password): ask for the email, then the
// same "check your email" answer whether or not an account exists.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import { Button, TextLink } from "@/components/kit/components/button";
import { TextField } from "@/components/kit/components/fields";
import AuthPage from "@/pages/prototype/auth/components/layout/auth-page";
import FormAlert from "@/pages/prototype/auth/components/form-alert";
import PrototypeNote from "@/pages/prototype/auth/components/prototype-note";
import WireNote from "@/pages/prototype/auth/components/wire-note";
import { useMockSubmit } from "@/pages/prototype/auth/hooks/use-mock-submit";
import {
  MOCK_EMAIL,
  RESET_TTL_HOURS,
  WIRE,
} from "@/pages/prototype/auth/lib/mock-auth-api";
import type { ForgotState, GoTo } from "@/pages/prototype/auth/lib/scenarios";
import { getEmailError } from "@/pages/prototype/auth/lib/validation";

type ForgotPasswordScreenProps = {
  state: ForgotState;
  onGo: GoTo;
};

export default function ForgotPasswordScreen({
  state,
  onGo,
}: ForgotPasswordScreenProps): ReactNode {
  const [email, setEmail] = useState(state === "ready" ? "" : MOCK_EMAIL);
  const [emailError, setEmailError] = useState<string | undefined>();
  const [isSent, setIsSent] = useState(state === "sent");
  const [isOfflineShown, setIsOfflineShown] = useState(state === "offline");
  const { isSubmitting, submit } = useMockSubmit(state === "sending", () =>
    setIsSent(true),
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const error = getEmailError(email);
    setEmailError(error);
    if (error) return;
    setIsOfflineShown(false);
    void submit();
  }

  const backToSignIn = (
    <TextLink onClick={() => onGo("login")}>
      <ArrowLeft aria-hidden className="size-4" />
      Back to sign in
    </TextLink>
  );

  if (isSent) {
    return (
      <AuthPage
        icon={MailCheck}
        iconTone="success"
        title="Check your email"
        body={
          <>
            If there&rsquo;s an account for{" "}
            <span className="font-semibold text-(--tl-ink)">{email.trim()}</span>,
            we&rsquo;ve sent it a link to choose a new password. The link works
            for {RESET_TTL_HOURS} hours.
          </>
        }
        footer={
          <p>
            Nothing after a few minutes? Check your spam folder, or{" "}
            <TextLink onClick={() => setIsSent(false)}>send another link</TextLink>
            .
          </p>
        }
        notes={
          <>
            <PrototypeNote>
              The 202 reads the same for a match, a miss and a throttled
              request, so this page can&rsquo;t promise an email was sent.
            </PrototypeNote>
            <WireNote exchange={WIRE.forgotOk} />
          </>
        }
      >
        <Button variant="primary" isFullWidth onClick={() => onGo("login")}>
          Back to sign in
        </Button>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="Forgot your password?"
      body="Enter the email you sign in with and we'll send you a link to choose a new one."
      footer={backToSignIn}
      notes={<WireNote exchange={state === "offline" ? WIRE.forgotOffline : WIRE.forgotOk} />}
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
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
          disabled={isSubmitting}
          onChange={(event) => setEmail(event.target.value)}
        />
        {isOfflineShown && (
          <FormAlert tone="danger" isOffline title="Couldn't reach TutorLink">
            Check your connection and try again.
          </FormAlert>
        )}
        <Button type="submit" variant="primary" isFullWidth isLoading={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthPage>
  );
}
