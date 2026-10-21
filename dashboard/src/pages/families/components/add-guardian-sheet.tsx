// Add guardian. On a family page ("family") it joins that family: linked
// to the ticked live Children, optionally sharing live Homes. From the
// Families list ("new-family", ticket 09) it starts a family, with an
// optional first Home. Keep it mounted and drive it with isOpen.
import type { ReactNode } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import CheckGroup from "@/pages/families/components/check-group";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useAddGuardianForm } from "@/pages/families/hooks/use-add-guardian-form";
import type { AddGuardianMode } from "@/pages/families/hooks/use-add-guardian-form";
import { useFirstFieldFocus } from "@/pages/families/hooks/use-first-field-focus";
import { getHomeLabel } from "@/pages/families/lib/family-labels";
import type { ClientRead, HouseholdHome, NamedRef } from "@/types/families";

const FORM_ID = "add-guardian-form";
// The API's cap (models/home.py DIRECTIONS_MAX_LENGTH).
const DIRECTIONS_MAX = 500;
const NEW_FAMILY_DESCRIPTION =
  "Starts a new family. Usually the bot does this at Intake.";

type AddGuardianSheetProps = {
  isOpen: boolean;
  mode: AddGuardianMode;
  // The family's live Children and Homes ("family" mode only).
  familyChildren?: NamedRef[];
  familyHomes?: HouseholdHome[];
  onClose: () => void;
  onAdded: (guardian: ClientRead) => void;
};

export default function AddGuardianSheet({
  isOpen,
  mode,
  familyChildren = [],
  familyHomes = [],
  onClose,
  onAdded,
}: AddGuardianSheetProps): ReactNode {
  const form = useAddGuardianForm({
    isOpen,
    mode,
    childIds: familyChildren.map((child) => child.id),
    onAdded,
  });
  const attachForm = useFirstFieldFocus(isOpen);
  const { draft, errors, isSaving } = form;
  const isFamily = mode === "family";

  function handleClose(): void {
    if (isSaving) return;
    onClose();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title="Add guardian"
      description={isFamily ? undefined : NEW_FAMILY_DESCRIPTION}
      footer={
        <>
          <Button onClick={handleClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            icon={UserPlus}
            isLoading={isSaving}
          >
            Add guardian
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
          label="Name"
          required
          autoComplete="name"
          value={draft.name}
          onChange={(event) => form.setName(event.target.value)}
          onBlur={form.validate}
          error={errors.name ?? undefined}
        />
        <TextField
          label="WhatsApp number"
          required
          type="tel"
          inputMode="tel"
          placeholder="+1 305 555 0100"
          help="The bot talks to them on this number."
          value={draft.phone}
          onChange={(event) => form.setPhone(event.target.value)}
          onBlur={form.validate}
          error={errors.phone ?? undefined}
        />
        {isFamily && familyChildren.length > 1 && (
          <CheckGroup legend="Linked to" error={errors.children}>
            {familyChildren.map((child) => (
              <CheckboxField
                key={child.id}
                label={child.name}
                isChecked={draft.childIds.includes(child.id)}
                onChange={(isChecked) => form.toggleChild(child.id, isChecked)}
              />
            ))}
          </CheckGroup>
        )}
        {isFamily && familyHomes.length > 0 && (
          <CheckGroup
            legend="Lives at"
            hint="Optional. Shares the Home, e.g. a couple living together."
          >
            {familyHomes.map((home) => (
              <CheckboxField
                key={home.id}
                label={getHomeLabel(home)}
                isChecked={draft.homeIds.includes(home.id)}
                onChange={(isChecked) => form.toggleHome(home.id, isChecked)}
              />
            ))}
          </CheckGroup>
        )}
        {!isFamily && (
          <>
            <TextField
              label="Home address"
              help="Optional. You can add Homes later on the family page."
              autoComplete="street-address"
              value={draft.address}
              onChange={(event) => form.setAddress(event.target.value)}
            />
            {draft.address.trim() && (
              <div className="kit-rise">
                <TextAreaField
                  label="Directions for Staff"
                  rows={2}
                  maxLength={DIRECTIONS_MAX}
                  value={draft.directions}
                  onChange={(event) => form.setDirections(event.target.value)}
                />
              </div>
            )}
          </>
        )}
        {form.failure && <SheetFailureLine message={form.failure} />}
      </form>
    </BottomSheet>
  );
}
