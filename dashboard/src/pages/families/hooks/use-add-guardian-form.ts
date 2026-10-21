// The Add guardian sheet's state: the draft, its checks (shown on submit,
// then on blur), the POST /api/clients and how its refusals read.
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorDetail, errorStatus } from "@/lib/api";
import { familyMutations } from "@/lib/queries/families";
import type { ClientCreate, ClientRead } from "@/types/families";

// "family" joins the open family; "new-family" starts one (ticket 09).
export type AddGuardianMode = "family" | "new-family";

const PHONE_PATTERN = /^\+?[\d\s()-]{10,}$/;
const CONFLICT = 409;
const BAD_REQUEST = 400;
// The API's 400s about the number name the field first
// ("phone_number is not a phone number that can be dialled").
const PHONE_FIELD = "phone_number";

const NAME_MISSING = "Enter the Guardian’s name.";
const PHONE_INVALID = "Enter a WhatsApp number with country code.";
const PHONE_TAKEN = "Another Guardian already has this number.";
const PHONE_UNREACHABLE =
  "Enter a WhatsApp number the bot can reach, with country code.";
const CHILD_MISSING = "Pick at least one Child.";

type GuardianDraft = {
  name: string;
  phone: string;
  childIds: string[];
  homeIds: string[];
  address: string;
  directions: string;
};

export type GuardianErrors = {
  name: string | null;
  phone: string | null;
  children: string | null;
};

const NO_ERRORS: GuardianErrors = { name: null, phone: null, children: null };

function getErrors(
  draft: GuardianDraft,
  mustPickChild: boolean,
): GuardianErrors {
  return {
    name: draft.name.trim() ? null : NAME_MISSING,
    phone: PHONE_PATTERN.test(draft.phone.trim()) ? null : PHONE_INVALID,
    children: mustPickChild && draft.childIds.length === 0 ? CHILD_MISSING : null,
  };
}

function hasErrors(errors: GuardianErrors): boolean {
  return Object.values(errors).some((error) => error !== null);
}

function toPayload(mode: AddGuardianMode, draft: GuardianDraft): ClientCreate {
  const base = { name: draft.name.trim(), phone_number: draft.phone.trim() };
  if (mode === "family") {
    return { ...base, child_ids: draft.childIds, home_ids: draft.homeIds };
  }
  const address = draft.address.trim();
  return {
    ...base,
    home: address
      ? { label: null, address, directions: draft.directions.trim() || null }
      : null,
  };
}

// Null when the refusal isn't about the number.
function getPhoneRefusal(error: unknown): string | null {
  const status = errorStatus(error);
  let refusal: string | null = null;
  if (status === CONFLICT) {
    refusal = PHONE_TAKEN;
  } else if (
    status === BAD_REQUEST &&
    (errorDetail(error) ?? "").startsWith(PHONE_FIELD)
  ) {
    refusal = PHONE_UNREACHABLE;
  }
  return refusal;
}

function toggle(ids: string[], id: string, isChecked: boolean): string[] {
  return isChecked ? [...ids, id] : ids.filter((item) => item !== id);
}

type AddGuardianFormOptions = {
  isOpen: boolean;
  mode: AddGuardianMode;
  // The live Children offered, all ticked at first (family mode).
  childIds: string[];
  onAdded: (guardian: ClientRead) => void;
};

export type AddGuardianForm = {
  draft: GuardianDraft;
  errors: GuardianErrors;
  failure: string | null;
  isSaving: boolean;
  setName: (name: string) => void;
  setPhone: (phone: string) => void;
  setAddress: (address: string) => void;
  setDirections: (directions: string) => void;
  toggleChild: (childId: string, isChecked: boolean) => void;
  toggleHome: (homeId: string, isChecked: boolean) => void;
  validate: () => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
};

export function useAddGuardianForm({
  isOpen,
  mode,
  childIds,
  onAdded,
}: AddGuardianFormOptions): AddGuardianForm {
  const create = useMutation(familyMutations.createGuardian());
  const { showToast } = useToast();
  const emptyDraft: GuardianDraft = {
    name: "",
    phone: "",
    childIds,
    homeIds: [],
    address: "",
    directions: "",
  };
  const [draft, setDraft] = useState(emptyDraft);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [errors, setErrors] = useState(NO_ERRORS);
  const [phoneRefusal, setPhoneRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // With one live Child it is sent alone; with none, nothing to pick.
  const mustPickChild = mode === "family" && childIds.length > 1;

  // Every open starts blank. Adjusted during render, not in an effect,
  // so the first frame is right.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setDraft(emptyDraft);
      setHasSubmitted(false);
      setErrors(NO_ERRORS);
      setPhoneRefusal(null);
      setFailure(null);
    }
  }

  function change(changes: Partial<GuardianDraft>): void {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function validate(): void {
    if (hasSubmitted) setErrors(getErrors(draft, mustPickChild));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (create.isPending) return;
    setHasSubmitted(true);
    setFailure(null);
    setPhoneRefusal(null);
    const nextErrors = getErrors(draft, mustPickChild);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) return;

    const name = draft.name.trim();
    create.mutate(toPayload(mode, draft), {
      onSuccess: (guardian) => {
        const message =
          mode === "family"
            ? `${name} added to the family.`
            : `${name} added as a new family.`;
        showToast({ tone: "success", message });
        onAdded(guardian);
      },
      onError: (error) => {
        const refusal = getPhoneRefusal(error);
        setPhoneRefusal(refusal);
        if (refusal === null) {
          setFailure(`Couldn’t add ${name}. Check your connection and try again.`);
        }
      },
    });
  }

  return {
    draft,
    errors: {
      ...errors,
      phone: phoneRefusal ?? errors.phone,
      // Ticks have no blur: their check follows them once submitted.
      children: hasSubmitted
        ? getErrors(draft, mustPickChild).children
        : null,
    },
    failure,
    isSaving: create.isPending,
    setName: (name) => change({ name }),
    setPhone: (phone) => {
      // The refusal was about the old number.
      setPhoneRefusal(null);
      change({ phone });
    },
    setAddress: (address) => change({ address }),
    setDirections: (directions) => change({ directions }),
    toggleChild: (childId, isChecked) =>
      setDraft((current) => ({
        ...current,
        childIds: toggle(current.childIds, childId, isChecked),
      })),
    toggleHome: (homeId, isChecked) =>
      setDraft((current) => ({
        ...current,
        homeIds: toggle(current.homeIds, homeId, isChecked),
      })),
    validate,
    submit,
  };
}
