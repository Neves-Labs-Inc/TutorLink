// Edit's form: Role (Tutor ↔ Manager, when allowed), Name, Email, and
// for a teaching profile Phone and Bio. The account saves first (PATCH
// /api/users); the profile only after it (PATCH /api/tutors), so a
// refused account saves nothing. Only changed fields are sent.
import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorDetail, errorStatus } from "@/lib/api";
import {
  refreshStaff,
  updateStaffAccount,
  updateTeachingProfile,
} from "@/lib/queries/staff";
import type {
  StaffAccountUpdate,
  StaffRead,
  StaffRole,
  TeachingProfileUpdate,
} from "@/lib/queries/staff";
import {
  clearFieldError,
  getStaffWriteErrors,
  validateStaffFields,
} from "@/pages/staff/lib/staff-form";
import type {
  StaffFieldErrors,
  StaffFieldValues,
} from "@/pages/staff/lib/staff-form";
import { PEER_ADMIN_LOCK } from "@/pages/staff/lib/staff-permissions";

const FORBIDDEN = 403;
const INVALID_FIELD = "[aria-invalid=true]";
const BAD_REQUEST = 400;
const SELF_ROLE_LOCK = "You can’t change your own role.";
// users.py's INVALID_SHAPE_ERROR: a Manager added without a teaching profile.
const NO_PROFILE_DETAIL = /requires a tutor profile/i;
const NO_PROFILE =
  "They have no teaching profile, so they can’t be a Tutor. Archive them and add them again as a Tutor.";
const SAVE_FAILED = "Couldn’t save. Check your connection and try again.";
const PROFILE_FAILED =
  "Saved their name, email and role, but not their phone and bio. Try again.";

export type EditStaffValues = StaffFieldValues & {
  role: StaffRole;
  bio: string;
};

type EditStaff = {
  values: EditStaffValues;
  errors: StaffFieldErrors;
  formError: string | null;
  isSaving: boolean;
  hasProfile: boolean;
  formRef: RefObject<HTMLFormElement | null>;
  changeValue: <K extends keyof EditStaffValues>(
    key: K,
    value: EditStaffValues[K],
  ) => void;
  handleBlur: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void;
  handleClose: () => void;
};

function getInitialValues(staff: StaffRead): EditStaffValues {
  return {
    role: staff.role,
    name: staff.name,
    email: staff.email,
    phone: staff.phone_number ?? "",
    bio: staff.bio ?? "",
  };
}

function getAccountChanges(
  staff: StaffRead,
  values: EditStaffValues,
): StaffAccountUpdate {
  const name = values.name.trim();
  const email = values.email.trim();
  return {
    ...(name !== staff.name && { name }),
    ...(email !== staff.email && { email }),
    ...(values.role !== staff.role && { role: values.role }),
  };
}

function getProfileChanges(
  staff: StaffRead,
  values: EditStaffValues,
): TeachingProfileUpdate {
  const phone = values.phone.trim();
  const bio = values.bio.trim();
  return {
    ...(phone !== (staff.phone_number ?? "") && { phone_number: phone }),
    ...(bio !== (staff.bio ?? "") && { bio: bio === "" ? null : bio }),
  };
}

// A refusal on its field, or the form alert's words for it.
function describeFailure(error: unknown): {
  fields: StaffFieldErrors;
  form: string | null;
} {
  const fields = getStaffWriteErrors(error);
  let form: string | null = fields ? null : SAVE_FAILED;
  const status = errorStatus(error);
  if (
    status === BAD_REQUEST &&
    NO_PROFILE_DETAIL.test(errorDetail(error) ?? "")
  ) {
    form = NO_PROFILE;
  } else if (status === FORBIDDEN) {
    form = /own role/i.test(errorDetail(error) ?? "")
      ? SELF_ROLE_LOCK
      : PEER_ADMIN_LOCK;
  }
  return { fields: fields ?? {}, form };
}

function hasAny(changes: object): boolean {
  return Object.keys(changes).length > 0;
}

export function useEditStaff(staff: StaffRead, onClose: () => void): EditStaff {
  const client = useQueryClient();
  const { showToast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState(() => getInitialValues(staff));
  const [fieldErrors, setFieldErrors] = useState<StaffFieldErrors>({});
  const [serverErrors, setServerErrors] = useState<StaffFieldErrors>({});
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const hasProfile = staff.tutor_id !== null;

  useEffect(() => {
    if (focusRequest > 0) {
      formRef.current?.querySelector<HTMLElement>(INVALID_FIELD)?.focus();
    }
  }, [focusRequest]);

  function changeValue<K extends keyof EditStaffValues>(
    key: K,
    value: EditStaffValues[K],
  ): void {
    setValues((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => clearFieldError(current, key));
  }

  function handleBlur(): void {
    if (hasSubmitted) setFieldErrors(validateStaffFields(values, hasProfile));
  }

  function showFailure(error: unknown, form: string | null): void {
    const failure = describeFailure(error);
    setServerErrors(failure.fields);
    setFormError(form ?? failure.form);
    if (hasAny(failure.fields)) setFocusRequest((count) => count + 1);
  }

  // True when every change landed.
  async function saveChanges(
    account: StaffAccountUpdate,
    profile: TeachingProfileUpdate,
  ): Promise<boolean> {
    const isAccountChanged = hasAny(account);
    let isAccountSaved = true;
    try {
      if (isAccountChanged) await updateStaffAccount(staff.id, account);
    } catch (error) {
      showFailure(error, null);
      isAccountSaved = false;
    }
    let isSaved = isAccountSaved;
    if (isAccountSaved && hasAny(profile) && staff.tutor_id) {
      try {
        await updateTeachingProfile(staff.tutor_id, profile);
      } catch (error) {
        showFailure(error, isAccountChanged ? PROFILE_FAILED : null);
        isSaved = false;
      }
    }
    // Whatever landed shows, the half-saved case included.
    if (isAccountSaved) await refreshStaff(client);
    return isSaved;
  }

  async function save(): Promise<void> {
    const invalid = validateStaffFields(values, hasProfile);
    setHasSubmitted(true);
    setFieldErrors(invalid);
    setServerErrors({});
    setFormError(null);
    if (hasAny(invalid)) {
      setFocusRequest((count) => count + 1);
      return;
    }
    const account = getAccountChanges(staff, values);
    const profile = hasProfile ? getProfileChanges(staff, values) : {};
    if (!hasAny(account) && !hasAny(profile)) {
      onClose();
      return;
    }
    setIsSaving(true);
    const isSaved = await saveChanges(account, profile);
    setIsSaving(false);
    if (isSaved) {
      showToast({ tone: "success", message: "Saved." });
      onClose();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isSaving) void save();
  }

  return {
    values,
    errors: { ...fieldErrors, ...serverErrors },
    formError,
    isSaving,
    hasProfile,
    formRef,
    changeValue,
    handleBlur,
    handleSubmit,
    // Closing mid-save would hide whether it worked.
    handleClose: () => {
      if (!isSaving) onClose();
    },
  };
}
