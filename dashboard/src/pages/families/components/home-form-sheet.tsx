// Add home / Edit home on the family page: address, label, directions,
// and "Whose home" when the family has 2+ live Guardians (otherwise it's
// the one). Keep it mounted and drive it with isOpen.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { House } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import CheckGroup from "@/pages/families/components/check-group";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useFirstFieldFocus } from "@/pages/families/hooks/use-first-field-focus";
import { useHomeForm } from "@/pages/families/hooks/use-home-form";
import type { HouseholdHome, NamedRef } from "@/types/families";

const FORM_ID = "home-form";
const LABEL_MAX = 64;
// The API's cap (models/home.py DIRECTIONS_MAX_LENGTH).
const DIRECTIONS_MAX = 500;

type HomeFormSheetProps = {
  isOpen: boolean;
  // Null adds a Home.
  home: HouseholdHome | null;
  liveGuardians: NamedRef[];
  onClose: () => void;
  onSaved: (homeId: string) => void;
};

export default function HomeFormSheet({
  isOpen,
  home,
  liveGuardians,
  onClose,
  onSaved,
}: HomeFormSheetProps): ReactNode {
  const form = useHomeForm({ isOpen, home, liveGuardians, onSaved });
  const attachForm = useFirstFieldFocus(isOpen);
  const { draft, errors, isSaving } = form;
  const isNew = home === null;
  // On a phone the failure line can land under the footer; bring it up.
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (form.failure) failureRef.current?.scrollIntoView({ block: "nearest" });
  }, [form.failure]);

  function handleClose(): void {
    if (isSaving) return;
    onClose();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={isNew ? "Add home" : "Edit home"}
      footer={
        <>
          <Button onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            icon={isNew ? House : undefined}
            isLoading={isSaving}
          >
            {isNew ? "Add home" : "Save home"}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        ref={attachForm}
        noValidate
        onSubmit={form.submit}
        className="flex flex-col gap-5"
      >
        <TextField
          label="Address"
          required
          autoComplete="street-address"
          value={draft.address}
          onChange={(event) => form.setField("address", event.target.value)}
          onBlur={form.validate}
          error={errors.address ?? undefined}
        />
        <TextField
          label="Label"
          help="Optional, e.g. “Dad’s”. Shown when booking."
          maxLength={LABEL_MAX}
          value={draft.label}
          onChange={(event) => form.setField("label", event.target.value)}
        />
        <TextAreaField
          label="Directions for Staff"
          help="Gate codes, parking, which door. Tutors see this with each Session."
          rows={3}
          maxLength={DIRECTIONS_MAX}
          value={draft.directions}
          onChange={(event) => form.setField("directions", event.target.value)}
        />
        {liveGuardians.length > 1 && (
          <CheckGroup legend="Whose home" error={errors.owners}>
            {liveGuardians.map((guardian) => (
              <CheckboxField
                key={guardian.id}
                label={guardian.name}
                isChecked={draft.ownerIds.includes(guardian.id)}
                onChange={(isChecked) => form.toggleOwner(guardian.id, isChecked)}
              />
            ))}
          </CheckGroup>
        )}
        {form.failure && (
          <div ref={failureRef}>
            <SheetFailureLine message={form.failure} />
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
