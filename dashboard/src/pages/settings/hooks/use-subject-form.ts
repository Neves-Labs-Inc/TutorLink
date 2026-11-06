// The Add / Edit subject form: Name, Spanish name, Description. Saves
// on its own (POST or PATCH /api/subjects), never through the Settings
// form. Mount a fresh instance per open (key) so it starts from the
// Subject as saved.
import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorDetail, errorStatus } from "@/lib/api";
import {
  createSubject,
  refreshSubjects,
  updateSubject,
} from "@/lib/queries/subjects";
import type { Subject } from "@/lib/queries/subjects";
import {
  descriptionValue,
  isNameEsError,
  isNameError,
  spanishNameValue,
  subjectErrorMessage,
  subjectNameValue,
} from "@/lib/subjects/subjects";

const BAD_REQUEST = 400;
const CONFLICT = 409;
const INVALID_FIELD = "[aria-invalid=true]";
const NAME_REQUIRED = "Enter a name.";
const NAME_TAKEN = "A subject with that name already exists.";
const ADD_FAILED =
  "Couldn’t add this Subject. Check your connection and try again.";
const SAVE_FAILED = "Couldn’t save. Check your connection and try again.";

export type SubjectValues = {
  name: string;
  nameEs: string;
  description: string;
};

export type SubjectErrors = { name?: string; nameEs?: string };

type SubjectForm = {
  values: SubjectValues;
  errors: SubjectErrors;
  formError: string | null;
  isSaving: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  changeValue: (key: keyof SubjectValues, value: string) => void;
  handleBlur: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleClose: () => void;
  clearFormError: () => void;
};

function getInitialValues(subject: Subject | null): SubjectValues {
  return {
    name: subject?.name ?? "",
    nameEs: subject?.name_es ?? "",
    description: subject?.description ?? "",
  };
}

function validate(values: SubjectValues): SubjectErrors {
  return subjectNameValue(values.name) === "" ? { name: NAME_REQUIRED } : {};
}

// A refusal on its field, or the form alert's words for it.
function describeFailure(
  error: unknown,
  fallback: string,
): { fields: SubjectErrors; form: string | null } {
  const status = errorStatus(error);
  const detail = errorDetail(error);
  const message = subjectErrorMessage(detail);
  let result = { fields: {} as SubjectErrors, form: fallback as string | null };
  if (status === CONFLICT) {
    result = { fields: { name: NAME_TAKEN }, form: null };
  } else if (status === BAD_REQUEST && message && isNameError(detail)) {
    result = { fields: { name: message }, form: null };
  } else if (status === BAD_REQUEST && message && isNameEsError(detail)) {
    result = { fields: { nameEs: message }, form: null };
  }
  return result;
}

export function useSubjectForm(
  subject: Subject | null,
  onClose: () => void,
  onAdded: () => void,
): SubjectForm {
  const client = useQueryClient();
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => getInitialValues(subject));
  const [fieldErrors, setFieldErrors] = useState<SubjectErrors>({});
  const [serverErrors, setServerErrors] = useState<SubjectErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);

  useEffect(() => {
    if (focusRequest > 0) {
      formRef.current?.querySelector<HTMLElement>(INVALID_FIELD)?.focus();
    }
  }, [focusRequest]);

  function changeValue(key: keyof SubjectValues, value: string): void {
    setValues((current) => ({ ...current, [key]: value }));
    if (key === "name" || key === "nameEs") {
      setServerErrors((current) => ({ ...current, [key]: undefined }));
    }
  }

  function handleBlur(): void {
    if (hasSubmitted) setFieldErrors(validate(values));
  }

  async function write(): Promise<void> {
    const data = {
      name: subjectNameValue(values.name),
      name_es: spanishNameValue(values.nameEs),
      description: descriptionValue(values.description),
    };
    await (subject ? updateSubject(subject.id, data) : createSubject(data));
  }

  async function save(): Promise<void> {
    const invalid = validate(values);
    setHasSubmitted(true);
    setFieldErrors(invalid);
    setServerErrors({});
    setFormError(null);
    if (Object.keys(invalid).length > 0) {
      setFocusRequest((count) => count + 1);
      return;
    }
    setIsSaving(true);
    try {
      await write();
      onClose();
      if (!subject) onAdded();
      showToast({
        tone: "success",
        message: subject ? "Subject saved." : "Subject added.",
      });
      void refreshSubjects(client);
    } catch (error) {
      const failure = describeFailure(
        error,
        subject ? SAVE_FAILED : ADD_FAILED,
      );
      setServerErrors(failure.fields);
      setFormError(failure.form);
      if (failure.fields.name || failure.fields.nameEs) {
        setFocusRequest((count) => count + 1);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isSaving) void save();
  }

  return {
    values,
    errors: {
      name: serverErrors.name ?? fieldErrors.name,
      nameEs: serverErrors.nameEs,
    },
    formError,
    isSaving,
    formRef,
    changeValue,
    handleBlur,
    handleSubmit,
    // Closing mid-save would hide whether it worked.
    handleClose: () => {
      if (!isSaving) onClose();
    },
    clearFormError: () => setFormError(null),
  };
}
