// The list's Add child sheet state: the Child's fields plus its required
// Guardian, new or existing. Checks show on submit, then on blur. A new
// Guardian is saved first; if the Child then fails, the form flips to
// Existing with that Guardian picked, so a retry posts only the Child.
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorDetail, errorStatus } from "@/lib/api";
import { familyMutations, familyQueries } from "@/lib/queries/families";
import { CHILD_NOTES_MAX } from "@/pages/families/components/child-fields";
import type {
  ChildFieldErrors,
  ChildFieldValues,
} from "@/pages/families/components/child-fields";
import type {
  ChildCreate,
  ChildRead,
  ClientSummary,
  NamedRef,
} from "@/types/families";

export type GuardianChoice = "new" | "existing";

export type GuardianOption = Pick<ClientSummary, "id" | "name" | "phone_number">;

const PHONE_PATTERN = /^\+?[\d\s()-]{10,}$/;
const CONFLICT = 409;
const BAD_REQUEST = 400;
// The API's 400s about the number name the field first.
const PHONE_FIELD = "phone_number";

const NAME_MISSING = "Enter the Child’s name.";
const BIRTH_MISSING = "Enter their date of birth.";
const NOTES_TOO_LONG = "Keep Child notes under 2,000 characters.";
const GUARDIAN_NAME_MISSING = "Enter the Guardian’s name.";
const PHONE_INVALID = "Enter a WhatsApp number with country code.";
const PHONE_TAKEN = "Another Guardian already has this number.";
const PHONE_UNREACHABLE =
  "Enter a WhatsApp number the bot can reach, with country code.";
const PICK_MISSING = "Pick a Guardian.";

type Draft = ChildFieldValues & {
  choice: GuardianChoice;
  guardianName: string;
  guardianPhone: string;
  pickedId: string | null;
  // Other Guardians of the picked family the Staff took off.
  untickedIds: string[];
};

export type AddChildFromListErrors = ChildFieldErrors & {
  guardianName: string | null;
  guardianPhone: string | null;
  pick: string | null;
};

const NO_ERRORS: AddChildFromListErrors = {
  name: null,
  dateOfBirth: null,
  notes: null,
  guardianName: null,
  guardianPhone: null,
  pick: null,
};

const EMPTY_DRAFT: Draft = {
  name: "",
  dateOfBirth: "",
  grade: "",
  school: "",
  notes: "",
  choice: "new",
  guardianName: "",
  guardianPhone: "",
  pickedId: null,
  untickedIds: [],
};

// Only the visible side of the Guardian choice is checked.
function getErrors(draft: Draft): AddChildFromListErrors {
  const isNew = draft.choice === "new";
  return {
    name: draft.name.trim() ? null : NAME_MISSING,
    dateOfBirth: draft.dateOfBirth ? null : BIRTH_MISSING,
    notes: draft.notes.length > CHILD_NOTES_MAX ? NOTES_TOO_LONG : null,
    guardianName:
      isNew && !draft.guardianName.trim() ? GUARDIAN_NAME_MISSING : null,
    guardianPhone:
      isNew && !PHONE_PATTERN.test(draft.guardianPhone.trim())
        ? PHONE_INVALID
        : null,
    pick: !isNew && !draft.pickedId ? PICK_MISSING : null,
  };
}

function hasErrors(errors: AddChildFromListErrors): boolean {
  return Object.values(errors).some((error) => error !== null);
}

function toPayload(draft: Draft, guardianIds: string[]): ChildCreate {
  return {
    guardian_ids: guardianIds,
    name: draft.name.trim(),
    date_of_birth: draft.dateOfBirth,
    grade_level: draft.grade === "" ? null : Number(draft.grade),
    school_name: draft.school.trim(),
    notes: draft.notes.trim() || null,
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

type AddChildFromListOptions = {
  isOpen: boolean;
  onAdded: (child: ChildRead) => void;
};

export type AddChildFromListForm = {
  draft: Draft;
  errors: AddChildFromListErrors;
  failure: string | null;
  isSaving: boolean;
  guardians: { options: GuardianOption[]; isLoading: boolean; isError: boolean; retry: () => void };
  family: {
    // The picked Guardian's other live Guardians, ticked unless unticked.
    others: NamedRef[];
    isLoading: boolean;
    isError: boolean;
    retry: () => void;
  };
  changeChild: (changes: Partial<ChildFieldValues>) => void;
  setChoice: (choice: GuardianChoice) => void;
  setGuardianName: (name: string) => void;
  setGuardianPhone: (phone: string) => void;
  pickGuardian: (guardianId: string) => void;
  toggleOther: (guardianId: string, isChecked: boolean) => void;
  validate: () => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
};

export function useAddChildFromListForm({
  isOpen,
  onAdded,
}: AddChildFromListOptions): AddChildFromListForm {
  const createGuardian = useMutation(familyMutations.createGuardian());
  const createChild = useMutation(familyMutations.createChild());
  const { showToast } = useToast();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [errors, setErrors] = useState(NO_ERRORS);
  const [phoneRefusal, setPhoneRefusal] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // The Guardian saved by a submit whose Child then failed.
  const [saved, setSaved] = useState<GuardianOption | null>(null);

  // Every open starts blank. Adjusted during render, not in an effect,
  // so the first frame is right.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setDraft(EMPTY_DRAFT);
      setHasSubmitted(false);
      setErrors(NO_ERRORS);
      setPhoneRefusal(null);
      setFailure(null);
      setSaved(null);
    }
  }

  const isExisting = draft.choice === "existing";
  const guardianList = useQuery({
    ...familyQueries.activeGuardians(),
    enabled: isOpen && isExisting,
  });
  const family = useQuery({
    ...familyQueries.household(draft.pickedId ?? ""),
    enabled: isOpen && isExisting && draft.pickedId !== null,
  });
  const listed = guardianList.data ?? [];
  const options =
    saved && !listed.some((guardian) => guardian.id === saved.id)
      ? [saved, ...listed]
      : listed;
  const others: NamedRef[] = (family.data?.guardians ?? [])
    .filter((guardian) => !guardian.archived && guardian.id !== draft.pickedId)
    .map((guardian) => ({ id: guardian.id, name: guardian.name }));

  function validate(): void {
    if (hasSubmitted) setErrors(getErrors(draft));
  }

  function change(changes: Partial<Draft>): void {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function getGuardianIds(pickedId: string): string[] {
    const ticked = others
      .filter((guardian) => !draft.untickedIds.includes(guardian.id))
      .map((guardian) => guardian.id);
    return [pickedId, ...ticked];
  }

  async function saveChild(guardianIds: string[]): Promise<void> {
    const child = await createChild.mutateAsync(toPayload(draft, guardianIds));
    showToast({ tone: "success", message: `${child.name} added.` });
    onAdded(child);
  }

  async function saveNewGuardian(childName: string): Promise<void> {
    const guardianName = draft.guardianName.trim();
    let guardian: GuardianOption;
    try {
      const created = await createGuardian.mutateAsync({
        name: guardianName,
        phone_number: draft.guardianPhone.trim(),
      });
      guardian = {
        id: created.id,
        name: created.name,
        phone_number: created.phone_number,
      };
    } catch (error) {
      const refusal = getPhoneRefusal(error);
      setPhoneRefusal(refusal);
      if (refusal === null) {
        setFailure(
          `Couldn’t add ${childName}. Check your connection and try again.`,
        );
      }
      return;
    }

    try {
      await saveChild([guardian.id]);
    } catch {
      setSaved(guardian);
      setDraft((current) => ({
        ...current,
        choice: "existing",
        pickedId: guardian.id,
        untickedIds: [],
      }));
      setErrors(NO_ERRORS);
      setFailure(`${guardianName} was added, but ${childName} wasn’t. Try again.`);
    }
  }

  async function saveWithExistingGuardian(childName: string): Promise<void> {
    try {
      await saveChild(getGuardianIds(draft.pickedId ?? ""));
    } catch {
      setFailure(
        `Couldn’t add ${childName}. Check your connection and try again.`,
      );
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving) return;
    setHasSubmitted(true);
    setFailure(null);
    setPhoneRefusal(null);
    const nextErrors = getErrors(draft);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) return;

    setIsSaving(true);
    const childName = draft.name.trim();
    if (isExisting) {
      await saveWithExistingGuardian(childName);
    } else {
      await saveNewGuardian(childName);
    }
    setIsSaving(false);
  }

  return {
    draft,
    errors: {
      ...errors,
      guardianPhone: phoneRefusal ?? errors.guardianPhone,
      // The picker has no blur: its check follows it once submitted.
      pick: hasSubmitted ? getErrors(draft).pick : null,
    },
    failure,
    isSaving,
    guardians: {
      options,
      isLoading: guardianList.isPending && isExisting && !saved,
      isError: guardianList.isError && !saved,
      retry: () => void guardianList.refetch(),
    },
    family: {
      others,
      isLoading: isExisting && draft.pickedId !== null && family.isPending,
      isError: family.isError,
      retry: () => void family.refetch(),
    },
    changeChild: change,
    setChoice: (choice) => {
      change({ choice });
      // The other side's checks may differ; refresh them once submitted.
      if (hasSubmitted) setErrors(getErrors({ ...draft, choice }));
    },
    setGuardianName: (guardianName) => change({ guardianName }),
    setGuardianPhone: (guardianPhone) => {
      // The refusal was about the old number.
      setPhoneRefusal(null);
      change({ guardianPhone });
    },
    pickGuardian: (pickedId) => change({ pickedId, untickedIds: [] }),
    toggleOther: (guardianId, isChecked) =>
      setDraft((current) => ({
        ...current,
        untickedIds: isChecked
          ? current.untickedIds.filter((id) => id !== guardianId)
          : [...current.untickedIds, guardianId],
      })),
    validate,
    submit: (event) => void submit(event),
  };
}
