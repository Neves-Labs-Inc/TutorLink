// Add staff's form: Role, Name, Email, Phone (Tutors and Managers only)
// and Send invite now. Errors show on submit, then follow each blur; a
// refused write lands on its field, anything else on the form alert.
// Success opens the new person's details on the Staff tab.
import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/kit/overlays/use-toast";
import { createStaff, refreshStaff } from "@/lib/queries/staff";
import type { StaffCreate, StaffRead, StaffRole } from "@/lib/queries/staff";
import {
  clearFieldError,
  getStaffWriteErrors,
  validateStaffFields,
} from "@/pages/staff/lib/staff-form";
import type {
  StaffFieldErrors,
  StaffFieldValues,
} from "@/pages/staff/lib/staff-form";

const STAFF_PATH = "/staff";
const INVALID_FIELD = "[aria-invalid=true]";
const ADD_FAILED = "Couldn’t add them. Check your connection and try again.";

export type AddStaffValues = StaffFieldValues & {
  role: StaffRole;
  shouldInvite: boolean;
};

const EMPTY_VALUES: AddStaffValues = {
  role: "tutor",
  name: "",
  email: "",
  phone: "",
  shouldInvite: true,
};

type AddStaff = {
  values: AddStaffValues;
  errors: StaffFieldErrors;
  formError: string | null;
  isSaving: boolean;
  hasPhone: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  changeValue: <K extends keyof AddStaffValues>(
    key: K,
    value: AddStaffValues[K],
  ) => void;
  handleBlur: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleClose: () => void;
};

function toPayload(values: AddStaffValues, hasPhone: boolean): StaffCreate {
  return {
    email: values.email.trim(),
    name: values.name.trim(),
    role: values.role,
    send_invite: values.shouldInvite,
    ...(hasPhone && { tutor: { phone_number: values.phone.trim() } }),
  };
}

function getAddedMessage(staff: StaffRead, hasInvited: boolean): string {
  return hasInvited
    ? `${staff.name} added. Invite sent to ${staff.email}.`
    : `${staff.name} added.`;
}

export function useAddStaff(onClose: () => void): AddStaff {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<AddStaffValues>(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<StaffFieldErrors>({});
  const [serverErrors, setServerErrors] = useState<StaffFieldErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const mutation = useMutation({ mutationFn: createStaff });
  const hasPhone = values.role !== "admin";
  const errors = { ...fieldErrors, ...serverErrors };

  useEffect(() => {
    if (focusRequest > 0) {
      formRef.current?.querySelector<HTMLElement>(INVALID_FIELD)?.focus();
    }
  }, [focusRequest]);

  function reset(): void {
    setValues(EMPTY_VALUES);
    setFieldErrors({});
    setServerErrors({});
    setHasSubmitted(false);
    setFormError(null);
  }

  function changeValue<K extends keyof AddStaffValues>(
    key: K,
    value: AddStaffValues[K],
  ): void {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => clearFieldError(current, key));
  }

  function handleBlur(): void {
    if (hasSubmitted) setFieldErrors(validateStaffFields(values, hasPhone));
  }

  function handleAdded(staff: StaffRead): void {
    showToast({
      tone: "success",
      message: getAddedMessage(staff, values.shouldInvite),
    });
    reset();
    onClose();
    // No `list` param: the list behind them is the Staff tab.
    navigate(`${STAFF_PATH}/${staff.id}`);
  }

  function handleFailed(error: unknown): void {
    const refused = getStaffWriteErrors(error);
    if (refused) {
      setServerErrors(refused);
      setFocusRequest((count) => count + 1);
    } else {
      setFormError(ADD_FAILED);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mutation.isPending) return;
    const invalid = validateStaffFields(values, hasPhone);
    setHasSubmitted(true);
    setFieldErrors(invalid);
    setServerErrors({});
    setFormError(null);
    if (Object.keys(invalid).length > 0) {
      setFocusRequest((count) => count + 1);
      return;
    }
    mutation.mutate(toPayload(values, hasPhone), {
      onSuccess: (staff) => {
        void refreshStaff(client);
        handleAdded(staff);
      },
      onError: handleFailed,
    });
  }

  function handleClose(): void {
    // Closing mid-save would hide whether it worked.
    if (mutation.isPending) return;
    reset();
    onClose();
  }

  return {
    values,
    errors,
    formError,
    isSaving: mutation.isPending,
    hasPhone,
    formRef,
    changeValue,
    handleBlur,
    handleSubmit,
    handleClose,
  };
}
