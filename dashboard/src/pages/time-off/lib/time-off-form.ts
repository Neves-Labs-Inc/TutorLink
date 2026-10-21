// The Request / Add time off form's rules: what it checks before sending,
// the body it sends, and how it reads the API's answer. Copy lives here so
// the sheet only renders.
import { errorDetail, errorStatus } from "@/lib/api";
import type {
  ExceptionCreate,
  ExceptionRead,
  TimeOffWarning,
} from "@/lib/queries/time-off";
import { getFirstName } from "@/pages/time-off/lib/time-off-copy";

export type TimeOffFormMode = "request" | "add";

export type TimeOffFormValues = {
  personId: string | null;
  first: string;
  last: string;
  isPartDay: boolean;
  from: string;
  to: string;
  reason: string;
};

export type TimeOffFormField = "person" | "first" | "last" | "to";

export type TimeOffFormErrors = Partial<Record<TimeOffFormField, string>>;

// A failed send: a field to point at, or the form-level alert.
export type TimeOffFormFailure =
  | { kind: "field"; field: TimeOffFormField; message: string }
  | { kind: "form"; message: string };

const HTTP_UNPROCESSABLE = 422;
// The 422 details of `api/app/routers/exceptions.py`.
const USER_ARCHIVED_DETAIL = "Time off cannot be entered for an archived user";
const WINDOW_ENDED_DETAIL = "This time off has already ended";

export const FORM_COPY = {
  person: "Pick who the time off is for.",
  firstEmpty: "Pick the first day off.",
  firstPast: "That day has passed. Pick today or later.",
  lastBeforeFirst: "The last day can’t be before the first.",
  toBeforeFrom: "Ends before it starts. Pick a later time.",
  archived: "This Staff member is archived.",
  failed: "Couldn’t save the time off. Check your connection and try again.",
} as const;

export const EMPTY_VALUES: Omit<TimeOffFormValues, "personId"> = {
  first: "",
  last: "",
  isPartDay: false,
  from: "13:00",
  to: "17:00",
  reason: "",
};

// `today` is the business date ("2031-10-20"); ISO dates and 24-hour
// times compare as plain strings.
export function validateTimeOff(
  values: TimeOffFormValues,
  mode: TimeOffFormMode,
  today: string,
): TimeOffFormErrors {
  const errors: TimeOffFormErrors = {};
  if (!values.personId) errors.person = FORM_COPY.person;
  if (values.first === "") {
    errors.first = FORM_COPY.firstEmpty;
  } else if (mode === "request" && values.first < today) {
    // An Admin may log time off that has passed; a requester may not.
    errors.first = FORM_COPY.firstPast;
  }
  if (values.first !== "" && values.last !== "" && values.last < values.first) {
    errors.last = FORM_COPY.lastBeforeFirst;
  }
  const hasHours = values.from !== "" && values.to !== "";
  if (values.isPartDay && (!hasHours || values.to <= values.from)) {
    errors.to = FORM_COPY.toBeforeFrom;
  }
  return errors;
}

export function buildTimeOffBody(
  values: TimeOffFormValues,
  warnings: TimeOffWarning[],
): ExceptionCreate {
  const reason = values.reason.trim();
  return {
    start_date: values.first,
    end_date: values.last || values.first,
    start_time: values.isPartDay ? `${values.from}:00` : null,
    end_time: values.isPartDay ? `${values.to}:00` : null,
    reason: reason === "" ? null : reason,
    // Sending again over a shown warning confirms it.
    confirm_warnings: warnings.map((warning) => warning.code),
  };
}

// `personName` is null when the time off is the viewer's own.
export function getSuccessMessage(
  mode: TimeOffFormMode,
  item: ExceptionRead,
  personName: string | null,
): string {
  let message = "Request sent. You’ll see here when an Admin decides.";
  if (mode === "add") {
    const who = personName === null ? "you" : getFirstName(personName);
    message = `Time off added for ${who}. It’s in effect now.`;
  } else if (item.clashing_bookings_count > 0) {
    message =
      "Request sent. If it’s approved, the office will sort out your sessions in those dates.";
  }
  return message;
}

export function readTimeOffFailure(error: unknown): TimeOffFormFailure {
  const detail =
    errorStatus(error) === HTTP_UNPROCESSABLE ? errorDetail(error) : null;
  let failure: TimeOffFormFailure = { kind: "form", message: FORM_COPY.failed };
  if (detail === USER_ARCHIVED_DETAIL) {
    failure = { kind: "field", field: "person", message: FORM_COPY.archived };
  } else if (detail === WINDOW_ENDED_DETAIL) {
    failure = { kind: "field", field: "first", message: FORM_COPY.firstPast };
  }
  return failure;
}
