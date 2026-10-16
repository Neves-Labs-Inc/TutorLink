// Add or edit a Home: the wire's three fields (ClientHomeCreate /
// HomeUpdate): an optional label, one address line, and directions.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import type {
  ClientHomeCreate,
  HomeRead,
} from "@/pages/prototype/accounts-staff/types/api";

const FORM_ID = "home-form";
const LABEL_MAX = 64;

type HomeFormSheetProps = {
  home: HomeRead | null;
  guardianName: string;
  onClose: () => void;
  onSave: (home: ClientHomeCreate) => void;
};

export default function HomeFormSheet({
  home,
  guardianName,
  onClose,
  onSave,
}: HomeFormSheetProps): ReactNode {
  const [label, setLabel] = useState(home?.label ?? "");
  const [address, setAddress] = useState(home?.address ?? "");
  const [directions, setDirections] = useState(home?.directions ?? "");
  const [hasTried, setHasTried] = useState(false);
  const isNew = home === null;
  const others = (home?.guardians ?? []).filter((g) => g.name !== guardianName);
  const addressError = hasTried && !address.trim() ? "Enter the full address." : undefined;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setHasTried(true);
    if (!address.trim()) return;
    // Blank label and directions are null on the wire.
    onSave({
      label: label.trim() || null,
      address: address.trim(),
      directions: directions.trim() || null,
    });
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title={isNew ? "Add home" : "Edit home"}
      description={
        others.length > 0
          ? `Shared with ${others.map((g) => g.name).join(", ")}: changes show for them too.`
          : `A place ${guardianName}’s Children can be booked.`
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={FORM_ID}>
            {isNew ? "Add home" : "Save home"}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextField
          label="Address"
          required
          autoComplete="street-address"
          placeholder="5600 NW 105th Ct, Doral, FL 33178"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          error={addressError}
        />
        <TextField
          label="Label"
          help="Optional, e.g. “Dad’s” or “Grandma’s”. Shown when booking."
          maxLength={LABEL_MAX}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <TextAreaField
          label="Directions for Staff"
          help="Gate codes, parking, which door. Tutors see this with each Session."
          rows={2}
          value={directions}
          onChange={(event) => setDirections(event.target.value)}
        />
      </form>
    </BottomSheet>
  );
}
