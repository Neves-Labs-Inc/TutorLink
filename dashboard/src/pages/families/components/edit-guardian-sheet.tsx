// Edit Guardian: name, WhatsApp number and Guardian language. The
// language can't change until they've messaged the bot (it lives on
// their chat). Mount a fresh instance per open (key) so it starts from
// the Guardian as saved.
import { useId } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { SelectField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useEditGuardian } from "@/pages/families/hooks/use-edit-guardian";
import type { ClientRead, Language } from "@/types/families";

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
];

type EditGuardianSheetProps = {
  guardian: ClientRead;
  isOpen: boolean;
  onClose: () => void;
};

export default function EditGuardianSheet({
  guardian,
  isOpen,
  onClose,
}: EditGuardianSheetProps): ReactNode {
  const formId = useId();
  const edit = useEditGuardian(guardian, onClose);
  const { form, errors } = edit;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void edit.save();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Guardian"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            isLoading={edit.isSaving}
          >
            Save guardian
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        <TextField
          label="Name"
          required
          autoComplete="name"
          value={form.name}
          error={errors.name}
          onChange={(event) => edit.setField("name", event.target.value)}
        />
        <TextField
          label="WhatsApp number"
          required
          type="tel"
          autoComplete="tel"
          value={form.phone}
          error={errors.phone}
          onChange={(event) => edit.setField("phone", event.target.value)}
        />
        <SelectField
          label="Guardian language"
          help={
            edit.hasChat
              ? "Every message to them uses it, Booking reminders included."
              : "Detected when they first message the bot. Until then, English."
          }
          disabled={!edit.hasChat}
          options={LANGUAGE_OPTIONS}
          value={form.language}
          // The only values are the two options above.
          onValueChange={(value) => edit.setField("language", value as Language)}
        />
        {errors.form && <SheetFailureLine message={errors.form} />}
      </form>
    </BottomSheet>
  );
}
