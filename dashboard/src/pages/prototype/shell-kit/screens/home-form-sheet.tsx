// Add or edit a Home: address fields in the kit's BottomSheet (a sheet
// on phones, a centred dialog card from 672px).
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { Home } from "@/pages/prototype/shell-kit/kit/mock-data";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import {
  TextAreaField,
  TextField,
} from "@/pages/prototype/shell-kit/kit/components/fields";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";

const FORM_ID = "home-form";

type HomeFormSheetProps = {
  home: Home | null;
  guardianName: string;
  onClose: () => void;
  onSave: (home: Home) => void;
};

type Errors = Partial<Record<"street" | "city" | "zip", string>>;

const ZIP_PATTERN = /^\d{5}$/;

function validate(home: Home): Errors {
  return {
    ...(home.street.trim() ? {} : { street: "Enter the street address." }),
    ...(home.city.trim() ? {} : { city: "Enter the city." }),
    ...(ZIP_PATTERN.test(home.zip.trim()) ? {} : { zip: "Enter a 5-digit ZIP code." }),
  };
}

// Mounted fresh for each open (keyed by the caller), so the draft starts
// from the Home being edited, or blank for a new one.
export default function HomeFormSheet({
  home,
  guardianName,
  onClose,
  onSave,
}: HomeFormSheetProps): ReactNode {
  const isNew = home === null || home.street === "";
  const [draft, setDraft] = useState<Home | null>(home);
  const [hasTriedSave, setHasTriedSave] = useState(false);
  if (!draft) return null;
  const errors = hasTriedSave ? validate(draft) : {};

  function update(patch: Partial<Home>): void {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setHasTriedSave(true);
    if (!draft || Object.keys(validate(draft)).length > 0) return;
    onSave(draft);
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title={isNew ? "Add home" : "Edit home"}
      description={`A place ${guardianName}’s Children can be booked.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={FORM_ID}>
            {isNew ? "Add home" : "Save home"}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={handleSubmit}
        className="flex flex-col gap-5"
      >
        <TextField
          label="Street address"
          required
          autoComplete="address-line1"
          value={draft.street}
          onChange={(event) => update({ street: event.target.value })}
          error={errors.street}
        />
        <TextField
          label="Apartment or unit"
          autoComplete="address-line2"
          value={draft.unit}
          onChange={(event) => update({ unit: event.target.value })}
        />
        <div className="grid gap-5 @md:grid-cols-[minmax(0,1fr)_88px_120px]">
          <TextField
            label="City"
            required
            autoComplete="address-level2"
            value={draft.city}
            onChange={(event) => update({ city: event.target.value })}
            error={errors.city}
          />
          <TextField
            label="State"
            autoComplete="address-level1"
            value={draft.state}
            onChange={(event) => update({ state: event.target.value })}
          />
          <TextField
            label="ZIP"
            required
            inputMode="numeric"
            autoComplete="postal-code"
            value={draft.zip}
            onChange={(event) => update({ zip: event.target.value })}
            error={errors.zip}
          />
        </div>
        <TextAreaField
          label="Directions for Staff"
          help="Gate codes, parking, which door. Tutors see this with each Session."
          rows={2}
          value={draft.directions}
          onChange={(event) => update({ directions: event.target.value })}
        />
      </form>
    </BottomSheet>
  );
}
