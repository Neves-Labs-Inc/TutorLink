// Edit details' form: name, date of birth, Overall grade, school and
// Child notes through PATCH /api/children/{id}. Only changed fields are
// sent. The API can't clear a date of birth or a grade (null means
// "leave it"), so once set they can only change.
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorDetail, errorStatus } from "@/lib/api";
import { familyMutations } from "@/lib/queries/families";
import type { ChildDetail, ChildUpdate } from "@/types/families";

const BAD_REQUEST = 400;
// children.py's INVALID_DATE_OF_BIRTH_ERROR starts with the field.
const DATE_OF_BIRTH_DETAIL = /^date_of_birth/;

const NAME_REQUIRED = "Enter the Child’s name.";
const DATE_OF_BIRTH_REQUIRED = "Enter their date of birth.";
const DATE_OF_BIRTH_INVALID = "Enter a real date of birth.";
const SAVE_FAILED = "Couldn’t save details. Check your connection and try again.";

// Select values are strings; "" is Not set.
export type ChildForm = {
  name: string;
  dateOfBirth: string;
  grade: string;
  school: string;
  notes: string;
};

export type EditChildErrors = {
  name?: string;
  dateOfBirth?: string;
  form?: string;
};

export type EditChild = {
  form: ChildForm;
  errors: EditChildErrors;
  isSaving: boolean;
  setField: (key: keyof ChildForm, value: string) => void;
  save: () => Promise<void>;
};

function getInitialForm(child: ChildDetail): ChildForm {
  return {
    name: child.name,
    dateOfBirth: child.date_of_birth ?? "",
    grade: child.grade_level === null ? "" : String(child.grade_level),
    school: child.school_name,
    notes: child.notes ?? "",
  };
}

function getRequiredErrors(child: ChildDetail, form: ChildForm): EditChildErrors {
  const isDateCleared = child.date_of_birth !== null && form.dateOfBirth === "";
  return {
    ...(form.name.trim() === "" && { name: NAME_REQUIRED }),
    ...(isDateCleared && { dateOfBirth: DATE_OF_BIRTH_REQUIRED }),
  };
}

function getChanges(child: ChildDetail, form: ChildForm): ChildUpdate {
  const name = form.name.trim();
  const school = form.school.trim();
  const notes = form.notes.trim();
  const grade = form.grade === "" ? null : Number(form.grade);
  return {
    ...(name !== child.name && { name }),
    ...(form.dateOfBirth !== "" &&
      form.dateOfBirth !== child.date_of_birth && {
        date_of_birth: form.dateOfBirth,
      }),
    ...(grade !== null && grade !== child.grade_level && { grade_level: grade }),
    ...(school !== child.school_name && { school_name: school }),
    // An empty string clears the notes; null would leave them.
    ...(notes !== (child.notes ?? "") && { notes }),
  };
}

function getSaveErrors(error: unknown): EditChildErrors {
  const isDateRefused =
    errorStatus(error) === BAD_REQUEST &&
    DATE_OF_BIRTH_DETAIL.test(errorDetail(error) ?? "");
  return isDateRefused
    ? { dateOfBirth: DATE_OF_BIRTH_INVALID }
    : { form: SAVE_FAILED };
}

export function useEditChild(child: ChildDetail, onSaved: () => void): EditChild {
  const { showToast } = useToast();
  const [form, setForm] = useState(() => getInitialForm(child));
  const [errors, setErrors] = useState<EditChildErrors>({});
  const updateChild = useMutation(familyMutations.updateChild());

  async function save(): Promise<void> {
    const required = getRequiredErrors(child, form);
    setErrors(required);
    if (required.name || required.dateOfBirth) return;

    const changes = getChanges(child, form);
    // Nothing changed: just close.
    if (Object.keys(changes).length === 0) {
      onSaved();
      return;
    }
    try {
      await updateChild.mutateAsync({ childId: child.id, changes });
      showToast({ tone: "success", message: "Details saved." });
      onSaved();
    } catch (error) {
      setErrors(getSaveErrors(error));
    }
  }

  return {
    form,
    errors,
    isSaving: updateChild.isPending,
    setField: (key, value) =>
      setForm((current) => ({ ...current, [key]: value })),
    save,
  };
}
