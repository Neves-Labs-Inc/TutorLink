// Add home from a family page: address, optional label and directions,
// and which of the family's Guardians it's saved on (all live ones by
// default). The API saves a Home on one Guardian (POST
// /api/clients/{id}/homes); sharing it with more needs an API change.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { CheckboxField } from "@/pages/prototype/shell-kit/kit/components/choices";
import { TextAreaField, TextField } from "@/pages/prototype/shell-kit/kit/components/fields";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import type { NamedRef } from "@/pages/prototype/accounts-staff/types/api";

const FORM_ID = "add-home-form";
const LABEL_MAX = 64;

type AddHomeSheetProps = {
  guardians: NamedRef[];
  onClose: () => void;
};

export default function AddHomeSheet({ guardians, onClose }: AddHomeSheetProps): ReactNode {
  const { addHome } = useArea();
  const { showToast } = useToast();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [directions, setDirections] = useState("");
  const [ownerIds, setOwnerIds] = useState(() => guardians.map((guardian) => guardian.id));
  const [hasTried, setHasTried] = useState(false);
  const addressError = hasTried && !address.trim() ? "Enter the full address." : undefined;
  const ownerError = hasTried && ownerIds.length === 0 ? "Pick at least one Guardian." : undefined;

  function toggleOwner(id: string, isChecked: boolean): void {
    setOwnerIds((current) => (isChecked ? [...current, id] : current.filter((item) => item !== id)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setHasTried(true);
    if (!address.trim() || ownerIds.length === 0) return;
    addHome(ownerIds, {
      label: label.trim() || null,
      address: address.trim(),
      directions: directions.trim() || null,
    });
    showToast({ tone: "success", message: "Home added. Their Children can be booked there." });
    onClose();
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Add home"
      description="A place this family’s Children can be booked."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={FORM_ID}>
            Add home
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
          onChange={(e) => setAddress(e.target.value)}
          error={addressError}
        />
        <TextField
          label="Label"
          help="Optional, e.g. “Dad’s” or “Grandma’s”. Shown when booking."
          maxLength={LABEL_MAX}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <TextAreaField
          label="Directions for Staff"
          help="Gate codes, parking, which door. Tutors see this with each Session."
          rows={2}
          value={directions}
          onChange={(e) => setDirections(e.target.value)}
        />
        {guardians.length > 1 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[14px] font-semibold">Whose home</legend>
            {guardians.map((guardian) => (
              <CheckboxField
                key={guardian.id}
                label={guardian.name}
                isChecked={ownerIds.includes(guardian.id)}
                onChange={(isChecked) => toggleOwner(guardian.id, isChecked)}
              />
            ))}
            {ownerError && <p className="text-[13px] text-(--tl-danger)">{ownerError}</p>}
          </fieldset>
        )}
      </form>
    </BottomSheet>
  );
}
