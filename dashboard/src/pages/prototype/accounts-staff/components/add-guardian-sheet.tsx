// Add guardian. From the Families list it starts a new family of one
// (POST /api/clients, with an optional first Home). From a family page
// it joins that family: linked to every Child in it (an assumption, see
// the "?"), and it can share the family's existing Homes.
import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { useToast } from "@/components/kit/overlays/use-toast";
import OpenQuestion from "@/pages/prototype/accounts-staff/components/open-question";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import type { HomeRead, NamedRef } from "@/pages/prototype/accounts-staff/types/api";

const FORM_ID = "add-guardian-form";
const PHONE_PATTERN = /^\+?[\d\s()-]{10,}$/;
const LINK_QUESTION =
  "Does a Guardian added on a family page link to every Child in it, or should the office pick which Children?";

type AddGuardianSheetProps = {
  // The family's Children the new Guardian links to; none from the list.
  childRefs: NamedRef[];
  shareableHomes: HomeRead[];
  onClose: () => void;
  onCreated: (guardianId: string) => void;
};

export default function AddGuardianSheet({
  childRefs,
  shareableHomes,
  onClose,
  onCreated,
}: AddGuardianSheetProps): ReactNode {
  const { addGuardian } = useArea();
  const { showToast } = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [sharedIds, setSharedIds] = useState<string[]>([]);
  const [address, setAddress] = useState("");
  const [directions, setDirections] = useState("");
  const [hasTried, setHasTried] = useState(false);
  const isInFamily = childRefs.length > 0;
  const nameError = hasTried && !name.trim() ? "Enter the Guardian’s name." : undefined;
  const phoneError =
    hasTried && !PHONE_PATTERN.test(phone.trim()) ? "Enter a WhatsApp number with country code." : undefined;

  function toggleShared(id: string, isChecked: boolean): void {
    setSharedIds((current) => (isChecked ? [...current, id] : current.filter((item) => item !== id)));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setHasTried(true);
    if (!name.trim() || !PHONE_PATTERN.test(phone.trim())) return;
    const id = addGuardian({
      name: name.trim(),
      phone_number: phone.replace(/[^\d+]/g, ""),
      home: address.trim()
        ? { label: null, address: address.trim(), directions: directions.trim() || null }
        : null,
      child_ids: childRefs.map((child) => child.id),
      shared_home_ids: sharedIds,
    });
    showToast({
      tone: "success",
      message: isInFamily ? `${name.trim()} added to the family.` : `${name.trim()} added: a new family.`,
    });
    onCreated(id);
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Add guardian"
      description={
        isInFamily
          ? `Linked to ${childRefs.map((child) => child.name.split(" ")[0]).join(" and ")}.`
          : "Starts a new family. Usually the bot does this at Intake."
      }
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={FORM_ID}>
            Add guardian
          </Button>
        </>
      }
    >
      {isInFamily && (
        <div className="mb-4 flex items-center gap-2 rounded-[16px] border border-dashed border-(--tl-field-border) py-1 pr-3 pl-1 text-[13px] text-(--tl-muted)">
          <OpenQuestion question={LINK_QUESTION} />
          Placeholder: linked to every Child in this family.
        </div>
      )}
      <form id={FORM_ID} noValidate onSubmit={handleSubmit} className="flex flex-col gap-5">
        <TextField label="Name" required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={nameError} />
        <TextField
          label="WhatsApp number"
          required
          type="tel"
          inputMode="tel"
          placeholder="+1 305 555 0100"
          help="The bot talks to them on this number."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={phoneError}
        />
        {shareableHomes.length > 0 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[14px] font-semibold">Lives at</legend>
            <p className="mb-1 text-[13px] text-(--tl-muted)">Optional. Shares the Home, e.g. a couple living together.</p>
            {shareableHomes.map((home) => (
              <CheckboxField
                key={home.id}
                label={home.label ? `${home.label}: ${home.address}` : home.address}
                isChecked={sharedIds.includes(home.id)}
                onChange={(isChecked) => toggleShared(home.id, isChecked)}
              />
            ))}
          </fieldset>
        )}
        {!isInFamily && (
          <>
            <TextField
              label="Home address"
              help="Optional. You can add Homes later on the family page."
              autoComplete="street-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            {address.trim() && (
              <TextAreaField label="Directions for Staff" rows={2} value={directions} onChange={(e) => setDirections(e.target.value)} />
            )}
          </>
        )}
      </form>
    </BottomSheet>
  );
}
