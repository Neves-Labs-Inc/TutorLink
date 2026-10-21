// The new-password form on Welcome and Set a new password. Rules are
// checked before anything is sent; the server's answers come in as props.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  getConfirmError,
  getNewPasswordError,
  PASSWORD_HELP,
} from "@/components/kit/auth/validation";
import { Avatar } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { PasswordField } from "@/components/kit/components/fields";
import { FormAlert } from "@/components/kit/states/states";

type Invitee = { name: string | null; email: string };

type FieldErrors = { password?: string; confirm?: string };

type PasswordFormProps = {
  // Set on Welcome only: whose account this is.
  invitee: Invitee | null;
  submitLabel: string;
  isSubmitting: boolean;
  // The server refused the password (422).
  rejectedPasswordError: string | undefined;
  hasSaveFailed: boolean;
  onSubmit: (password: string) => void;
};

function IdentityPill({ name, email }: Invitee): ReactNode {
  return (
    <div className="flex items-center gap-3 rounded-full bg-(--tl-surface-sunk) py-1.5 pr-4 pl-1.5">
      <Avatar name={name ?? email} size="sm" />
      <div className="flex min-w-0 flex-col">
        {name && (
          <span
            title={name}
            className="truncate text-[14px] leading-5 font-semibold text-(--tl-ink)"
          >
            {name}
          </span>
        )}
        <span
          title={email}
          className="truncate text-[13px] leading-[18px] text-(--tl-muted)"
        >
          {email}
        </span>
      </div>
    </div>
  );
}

export default function PasswordForm({
  invitee,
  submitLabel,
  isSubmitting,
  rejectedPasswordError,
  hasSaveFailed,
  onSubmit,
}: PasswordFormProps): ReactNode {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextErrors = {
      password: getNewPasswordError(password),
      confirm: getConfirmError(password, confirm),
    };
    setErrors(nextErrors);
    if (nextErrors.password || nextErrors.confirm) return;

    onSubmit(password);
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
      {invitee && (
        <>
          <IdentityPill name={invitee.name} email={invitee.email} />
          {/* Lets a password manager file the new password under this email. */}
          <input
            type="email"
            name="username"
            autoComplete="username"
            value={invitee.email}
            readOnly
            hidden
          />
        </>
      )}
      <PasswordField
        label="New password"
        name="new-password"
        autoComplete="new-password"
        value={password}
        help={PASSWORD_HELP}
        error={errors.password ?? rejectedPasswordError}
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
      {hasSaveFailed && (
        <FormAlert tone="danger" isOffline title="Couldn’t save your password">
          Check your connection and try again. Your link still works.
        </FormAlert>
      )}
      <Button
        type="submit"
        variant="primary"
        isFullWidth
        isLoading={isSubmitting}
      >
        {isSubmitting ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
