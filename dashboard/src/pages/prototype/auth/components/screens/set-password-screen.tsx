// Set password (today's /set-password?token=…), in two framings: first
// sign-in from an Invite, and a new password from a reset link. Saving
// signs the person in (the API answers with a TokenPair).
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArrowLeft, UserRound } from "lucide-react";
import { Button, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import AuthPage from "@/pages/prototype/auth/components/layout/auth-page";
import FormAlert from "@/pages/prototype/auth/components/form-alert";
import PasswordField from "@/pages/prototype/auth/components/password-field";
import PrototypeNote from "@/pages/prototype/auth/components/prototype-note";
import WireNote from "@/pages/prototype/auth/components/wire-note";
import { useMockSubmit } from "@/pages/prototype/auth/hooks/use-mock-submit";
import { MOCK_EMAIL, WIRE } from "@/pages/prototype/auth/lib/mock-auth-api";
import type { WireExchange } from "@/pages/prototype/auth/lib/mock-auth-api";
import type { GoTo, SetPasswordState } from "@/pages/prototype/auth/lib/scenarios";
import {
  getConfirmError,
  getNewPasswordError,
  PASSWORD_HELP,
  PASSWORD_TOO_LONG,
} from "@/pages/prototype/auth/lib/validation";

const LONG_PASSWORD = "correct-horse-battery-staple-".repeat(3);

const WIRE_BY_STATE: Record<SetPasswordState, WireExchange | null> = {
  ready: WIRE.setOk,
  submitting: WIRE.setOk,
  mismatch: null,
  "too-long": WIRE.setBadPassword,
  offline: WIRE.setOffline,
};

type Mode = "invite" | "reset";

const COPY: Record<Mode, { title: string; body: string; submit: string }> = {
  invite: {
    title: "Welcome to TutorLink",
    body: "Choose a password to finish setting up your account. You'll sign in with it and your email from now on.",
    submit: "Set password and sign in",
  },
  reset: {
    title: "Choose a new password",
    body: "Your old password stops working once you save this one, and you'll be signed in.",
    submit: "Save password and sign in",
  },
};

type FieldErrors = { password?: string; confirm?: string };

function getInitialFields(state: SetPasswordState): [string, string, FieldErrors] {
  const fields: Record<SetPasswordState, [string, string, FieldErrors]> = {
    ready: ["", "", {}],
    submitting: ["sunflower-42", "sunflower-42", {}],
    mismatch: [
      "sunflower-42",
      "sunflower-24",
      { confirm: "The two passwords don't match." },
    ],
    "too-long": [LONG_PASSWORD, LONG_PASSWORD, { password: PASSWORD_TOO_LONG }],
    offline: ["sunflower-42", "sunflower-42", {}],
  };
  return fields[state];
}

type SetPasswordScreenProps = {
  mode: Mode;
  state: SetPasswordState;
  onGo: GoTo;
  onSignedIn: () => void;
};

export default function SetPasswordScreen({
  mode,
  state,
  onGo,
  onSignedIn,
}: SetPasswordScreenProps): ReactNode {
  const [initialPassword, initialConfirm, initialErrors] = getInitialFields(state);
  const [password, setPassword] = useState(initialPassword);
  const [confirm, setConfirm] = useState(initialConfirm);
  const [errors, setErrors] = useState<FieldErrors>(initialErrors);
  const [isOfflineShown, setIsOfflineShown] = useState(state === "offline");
  const { isSubmitting, submit } = useMockSubmit(state === "submitting", onSignedIn);
  const copy = COPY[mode];

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const next = {
      password: getNewPasswordError(password),
      confirm: getConfirmError(password, confirm),
    };
    setErrors(next);
    if (next.password || next.confirm) return;
    setIsOfflineShown(false);
    void submit();
  }

  const footer =
    mode === "invite" ? (
      <p>
        Already chose a password?{" "}
        <TextLink onClick={() => onGo("login")}>Sign in</TextLink>
      </p>
    ) : (
      <TextLink onClick={() => onGo("login")}>
        <ArrowLeft aria-hidden className="size-4" />
        Back to sign in
      </TextLink>
    );

  return (
    <AuthPage
      title={copy.title}
      body={copy.body}
      footer={footer}
      notes={
        <>
          <PrototypeNote kind="question">
            The page can&rsquo;t tell an Invite from a reset link today: both
            open /set-password?token=… and nothing says which. These two
            framings need the link to carry its purpose, or a lookup endpoint.
          </PrototypeNote>
          <PrototypeNote kind="question">
            A used or expired link is only found out on submit (400), after the
            person has typed a password. Check the link on arrival instead?
            Needs a lookup endpoint.
          </PrototypeNote>
          {state === "too-long" && (
            <PrototypeNote>
              The browser catches this before sending (72-byte limit); the
              422 maps to the same words if it ever gets through.
            </PrototypeNote>
          )}
          <WireNote exchange={WIRE_BY_STATE[state]} />
        </>
      }
    >
      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        {mode === "invite" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 rounded-full bg-(--tl-surface-sunk) py-1.5 pr-4 pl-1.5">
              <span className="inline-flex size-8 items-center justify-center rounded-full bg-(--tl-tint-strong) text-(--tl-primary-ink)">
                <UserRound aria-hidden className="size-4" />
              </span>
              <span className="min-w-0 truncate text-[14px] text-(--tl-ink-soft)">
                {MOCK_EMAIL}
              </span>
            </div>
            <PrototypeNote kind="question">
              Show whose account this is before they choose a password? It
              reassures the invitee and lets password managers save the email,
              but the API can&rsquo;t say yet.
            </PrototypeNote>
          </div>
        )}
        <PasswordField
          label="New password"
          name="new-password"
          autoComplete="new-password"
          value={password}
          help={PASSWORD_HELP}
          error={errors.password}
          disabled={isSubmitting}
          onChange={(event) => setPassword(event.target.value)}
        />
        <PasswordField
          label="Type it again"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          error={errors.confirm}
          disabled={isSubmitting}
          onChange={(event) => setConfirm(event.target.value)}
        />
        {isOfflineShown && (
          <FormAlert tone="danger" isOffline title="Couldn't save your password">
            Check your connection and try again. Your link still works.
          </FormAlert>
        )}
        <Button type="submit" variant="primary" isFullWidth isLoading={isSubmitting}>
          {isSubmitting ? "Saving…" : copy.submit}
        </Button>
      </form>
    </AuthPage>
  );
}
