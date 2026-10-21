// The Add child sheet's state: the draft, its checks (shown on submit,
// then on blur) and the POST /api/children.
import { useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { familyMutations } from "@/lib/queries/families";
import { CHILD_NOTES_MAX } from "@/pages/families/components/child-fields";
import type {
  ChildFieldErrors,
  ChildFieldValues,
} from "@/pages/families/components/child-fields";
import type { ChildCreate, ChildRead } from "@/types/families";

const NAME_MISSING = "Enter the Child’s name.";
const BIRTH_MISSING = "Enter their date of birth.";
const NOTES_TOO_LONG = "Keep Child notes under 2,000 characters.";
const GUARDIAN_MISSING = "Pick at least one Guardian.";

type ChildDraft = ChildFieldValues & { guardianIds: string[] };

export type AddChildErrors = ChildFieldErrors & { guardians: string | null };

const NO_ERRORS: AddChildErrors = {
  name: null,
  dateOfBirth: null,
  notes: null,
  guardians: null,
};

function getErrors(draft: ChildDraft): AddChildErrors {
  return {
    name: draft.name.trim() ? null : NAME_MISSING,
    dateOfBirth: draft.dateOfBirth ? null : BIRTH_MISSING,
    notes: draft.notes.length > CHILD_NOTES_MAX ? NOTES_TOO_LONG : null,
    guardians: draft.guardianIds.length === 0 ? GUARDIAN_MISSING : null,
  };
}

function hasErrors(errors: AddChildErrors): boolean {
  return Object.values(errors).some((error) => error !== null);
}

function toPayload(draft: ChildDraft): ChildCreate {
  return {
    guardian_ids: draft.guardianIds,
    name: draft.name.trim(),
    date_of_birth: draft.dateOfBirth,
    grade_level: draft.grade === "" ? null : Number(draft.grade),
    school_name: draft.school.trim(),
    notes: draft.notes.trim() || null,
  };
}

type AddChildFormOptions = {
  isOpen: boolean;
  // The live Guardians the Child can belong to, all ticked at first.
  guardianIds: string[];
  onAdded: (child: ChildRead) => void;
};

export type AddChildForm = {
  draft: ChildDraft;
  errors: AddChildErrors;
  failure: string | null;
  isSaving: boolean;
  change: (changes: Partial<ChildFieldValues>) => void;
  toggleGuardian: (guardianId: string, isChecked: boolean) => void;
  validate: () => void;
  submit: (event: FormEvent<HTMLFormElement>) => void;
};

export function useAddChildForm({
  isOpen,
  guardianIds,
  onAdded,
}: AddChildFormOptions): AddChildForm {
  const create = useMutation(familyMutations.createChild());
  const { showToast } = useToast();
  const emptyDraft: ChildDraft = {
    name: "",
    dateOfBirth: "",
    grade: "",
    school: "",
    notes: "",
    guardianIds,
  };
  const [draft, setDraft] = useState(emptyDraft);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [errors, setErrors] = useState(NO_ERRORS);
  const [failure, setFailure] = useState<string | null>(null);

  // Every open starts blank. Adjusted during render, not in an effect,
  // so the first frame is right.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setDraft(emptyDraft);
      setHasSubmitted(false);
      setErrors(NO_ERRORS);
      setFailure(null);
    }
  }

  function validate(): void {
    if (hasSubmitted) setErrors(getErrors(draft));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (create.isPending) return;
    setHasSubmitted(true);
    setFailure(null);
    const nextErrors = getErrors(draft);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) return;

    const name = draft.name.trim();
    create.mutate(toPayload(draft), {
      onSuccess: (child) => {
        showToast({ tone: "success", message: `${name} added to the family.` });
        onAdded(child);
      },
      onError: () =>
        setFailure(`Couldn’t add ${name}. Check your connection and try again.`),
    });
  }

  return {
    draft,
    errors: {
      ...errors,
      // Ticks have no blur: their check follows them once submitted.
      guardians: hasSubmitted ? getErrors(draft).guardians : null,
    },
    failure,
    isSaving: create.isPending,
    change: (changes) => setDraft((current) => ({ ...current, ...changes })),
    toggleGuardian: (guardianId, isChecked) =>
      setDraft((current) => ({
        ...current,
        guardianIds: isChecked
          ? [...current.guardianIds, guardianId]
          : current.guardianIds.filter((id) => id !== guardianId),
      })),
    validate,
    submit,
  };
}
