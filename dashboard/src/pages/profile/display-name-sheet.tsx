// The Display name editor: a kit BottomSheet with one field. Kept mounted
// by the page and driven by isOpen, so its exit can play.
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { useToast } from "@/components/kit/overlays/use-toast";
import { useMyProfile } from "@/hooks/useMyProfile";
import { displayNameError } from "@/lib/users/users";
import { useAuthStore } from "@/stores/authStore";

const OFFICE_HELP = "Guardians and other Staff see your Display name in chats.";
const TUTOR_HELP = "The office sees your Display name instead of your email.";
const SAVE_FAILED = "Couldn’t save your Display name. Try again.";
const FORM_ID = "display-name-form";

type DisplayNameSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  savedName: string;
};

export function DisplayNameSheet({
  isOpen,
  onClose,
  savedName,
}: DisplayNameSheetProps): ReactNode {
  const { save } = useMyProfile();
  const { showToast } = useToast();
  const [draft, setDraft] = useState(savedName);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaveFailed, setIsSaveFailed] = useState(false);
  const isSaving = save.isPending;
  const isTutor = useAuthStore((state) => state.role) === "tutor";
  const formRef = useRef<HTMLFormElement | null>(null);

  // The panel grabs focus itself on open; take it back a frame later.
  const focusField = useCallback(() => {
    const input = formRef.current?.querySelector("input");
    if (!input) return;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }, []);
  const attachForm = useCallback(
    (form: HTMLFormElement | null) => {
      formRef.current = form;
      if (form) focusField();
    },
    [focusField],
  );
  // Reopening mid-exit keeps the form mounted, so the ref callback stays quiet.
  useEffect(() => {
    if (isOpen) focusField();
  }, [isOpen, focusField]);

  // Every open starts from the saved name, whatever was typed before.
  // Adjusted during render, not in an effect, so the first frame is right.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setDraft(savedName);
      setHasSubmitted(false);
      setError(null);
      setIsSaveFailed(false);
    }
  }

  function handleClose(): void {
    if (isSaving) return;
    onClose();
  }

  function handleBlur(): void {
    if (hasSubmitted) setError(displayNameError(draft));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isSaving) return;
    setHasSubmitted(true);
    setIsSaveFailed(false);

    const validationError = displayNameError(draft);
    setError(validationError);
    if (validationError !== null) return;

    const name = draft.trim();
    if (name === savedName.trim()) {
      handleClose();
      return;
    }
    save.mutate(
      { name },
      {
        onSuccess: () => {
          onClose();
          showToast({ tone: "success", message: "Display name saved." });
        },
        onError: () => setIsSaveFailed(true),
      },
    );
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title="Display name"
      footer={
        <div className="flex w-full flex-col gap-2">
          <div className="flex flex-col-reverse gap-2 @md:flex-row @md:justify-end">
            <Button variant="outline" onClick={handleClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={FORM_ID}
              variant="primary"
              isLoading={isSaving}
            >
              Save
            </Button>
          </div>
          {isSaveFailed && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-[13px] leading-[18px] text-(--tl-danger) @md:justify-end"
            >
              <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
              {SAVE_FAILED}
            </p>
          )}
        </div>
      }
    >
      <form id={FORM_ID} ref={attachForm} onSubmit={handleSubmit} noValidate>
        <TextField
          label="Display name"
          help={isTutor ? TUTOR_HELP : OFFICE_HELP}
          error={error ?? undefined}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={handleBlur}
          disabled={isSaving}
          autoComplete="name"
        />
      </form>
    </BottomSheet>
  );
}
