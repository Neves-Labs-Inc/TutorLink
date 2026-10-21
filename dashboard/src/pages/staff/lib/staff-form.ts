// What Add staff and Edit check before saving, and how a refused write
// lands on the field it is about (`api/app/routers/{users,tutors}.py`).
import { errorDetail, errorStatus } from "@/lib/api";

export type StaffField = "name" | "email" | "phone";

export type StaffFieldErrors = Partial<Record<StaffField, string>>;

export type StaffFieldValues = { name: string; email: string; phone: string };

const BAD_REQUEST = 400;
const CONFLICT = 409;

const NAME_REQUIRED = "Enter their name.";
const EMAIL_REQUIRED = "Enter an email address. Their Invite goes here.";
const EMAIL_TAKEN = "Someone on Staff already uses this email.";
const PHONE_REQUIRED = "Enter a phone number.";
const PHONE_INVALID = "Enter a phone number that can be dialled.";
const PHONE_TAKEN = "Another Staff member already uses this phone number.";

// The API's own rule (`schemas/user.py`): something, with an @ in it.
function isEmail(text: string): boolean {
  return text.trim() !== "" && text.includes("@");
}

export function validateStaffFields(
  values: StaffFieldValues,
  hasPhone: boolean,
): StaffFieldErrors {
  return {
    ...(values.name.trim() === "" && { name: NAME_REQUIRED }),
    ...(!isEmail(values.email) && { email: EMAIL_REQUIRED }),
    ...(hasPhone && values.phone.trim() === "" && { phone: PHONE_REQUIRED }),
  };
}

// A refused write's field error, or null when it isn't about a field.
export function getStaffWriteErrors(error: unknown): StaffFieldErrors | null {
  const status = errorStatus(error);
  const detail = errorDetail(error) ?? "";
  const isAboutPhone = /phone/i.test(detail);
  let errors: StaffFieldErrors | null = null;
  if (status === CONFLICT) {
    errors = isAboutPhone ? { phone: PHONE_TAKEN } : { email: EMAIL_TAKEN };
  } else if (status === BAD_REQUEST && isAboutPhone) {
    errors = { phone: PHONE_INVALID };
  } else if (status === BAD_REQUEST && /email/i.test(detail)) {
    errors = { email: EMAIL_REQUIRED };
  }
  return errors;
}

// A refusal holds until its field changes.
export function clearFieldError(
  errors: StaffFieldErrors,
  field: string,
): StaffFieldErrors {
  return Object.fromEntries(
    Object.entries(errors).filter(([key]) => key !== field),
  );
}
