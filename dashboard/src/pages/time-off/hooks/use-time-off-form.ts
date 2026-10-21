// The Request / Add time off sheet's state: the values, when errors show
// (on submit, then on blur), the clash warning to confirm, and the send.
import { useEffect, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getTodayKey } from "@/components/kit/format";
import { prefersReducedMotion } from "@/components/kit/overlays/use-enter-animation";
import { useToast } from "@/components/kit/overlays/use-toast";
import type { ComboboxOption } from "@/components/kit/types/combobox";
import { staffQueries } from "@/lib/queries/staff";
import { timeOffMutations } from "@/lib/queries/time-off";
import type {
  ExceptionRead,
  NamedRef,
  TimeOffWarning,
} from "@/lib/queries/time-off";
import { roleLabel } from "@/lib/users/users";
import {
  buildTimeOffBody,
  EMPTY_VALUES,
  FORM_COPY,
  getSuccessMessage,
  readTimeOffFailure,
  validateTimeOff,
} from "@/pages/time-off/lib/time-off-form";
import type {
  TimeOffFormErrors,
  TimeOffFormField,
  TimeOffFormMode,
  TimeOffFormValues,
} from "@/pages/time-off/lib/time-off-form";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";

type FieldValues = Omit<TimeOffFormValues, "personId">;

type ServerError = { field: TimeOffFormField; message: string };

export type StaffPickerState =
  | { kind: "loading" }
  | { kind: "error"; isRetrying: boolean; onRetry: () => void }
  | { kind: "ready"; options: ComboboxOption[] };

type UseTimeOffFormOptions = {
  isOpen: boolean;
  mode: TimeOffFormMode;
  viewer: Viewer;
  person: NamedRef | null;
  onClose: () => void;
  onCreated: (item: ExceptionRead) => void;
};

export type TimeOffForm = {
  values: TimeOffFormValues;
  errors: TimeOffFormErrors;
  warnings: TimeOffWarning[];
  formError: string | null;
  isSaving: boolean;
  // Null when the person is fixed (request mode, or a preset person).
  picker: StaffPickerState | null;
  formRef: RefObject<HTMLFormElement | null>;
  wellRef: RefObject<HTMLDivElement | null>;
  pickPerson: (id: string) => void;
  changeField: (change: Partial<FieldValues>) => void;
  handleBlur: () => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  handleClose: () => void;
};

const INVALID_FIELD = '[aria-invalid="true"]';

export function useTimeOffForm({
  isOpen,
  mode,
  viewer,
  person,
  onClose,
  onCreated,
}: UseTimeOffFormOptions): TimeOffForm {
  const hasPicker = mode === "add" && person === null;
  const staff = useQuery({
    ...staffQueries.active(),
    select: (page) => page.items,
    enabled: hasPicker && isOpen,
  });
  const create = useMutation(timeOffMutations.create());
  const { showToast } = useToast();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [fields, setFields] = useState<FieldValues>(EMPTY_VALUES);
  const [clientErrors, setClientErrors] = useState<TimeOffFormErrors>({});
  const [serverError, setServerError] = useState<ServerError | null>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [warnings, setWarnings] = useState<TimeOffWarning[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const hasWarnings = warnings.length > 0;

  const fixedId = mode === "request" ? viewer.id : (person?.id ?? null);
  const personId = hasPicker ? pickedId : fixedId;
  const values: TimeOffFormValues = { ...fields, personId };
  const errors: TimeOffFormErrors = serverError
    ? { ...clientErrors, [serverError.field]: serverError.message }
    : clientErrors;

  useEffect(() => {
    if (focusRequest > 0) {
      formRef.current?.querySelector<HTMLElement>(INVALID_FIELD)?.focus();
    }
  }, [focusRequest]);

  useEffect(() => {
    if (hasWarnings) {
      wellRef.current?.scrollIntoView({
        block: "nearest",
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    }
  }, [hasWarnings]);

  function revalidate(next: TimeOffFormValues): void {
    if (hasSubmitted) setClientErrors(validateTimeOff(next, mode, getTodayKey()));
  }

  // Every change but the reason moves the window or the person, so a
  // shown clash warning no longer holds.
  function changeField(change: Partial<FieldValues>): void {
    setFields((current) => ({ ...current, ...change }));
    const isReasonOnly = Object.keys(change).every((key) => key === "reason");
    if (!isReasonOnly) setWarnings([]);
    const isServerFieldChanged =
      serverError?.field === "first" && change.first !== undefined;
    if (isServerFieldChanged) setServerError(null);
  }

  // A pick is the Combobox's commit, so it revalidates like a blur.
  function pickPerson(id: string): void {
    setPickedId(id);
    setWarnings([]);
    if (serverError?.field === "person") setServerError(null);
    revalidate({ ...values, personId: id });
  }

  function handleBlur(): void {
    revalidate(values);
  }

  function reset(): void {
    setPickedId(null);
    setFields(EMPTY_VALUES);
    setClientErrors({});
    setServerError(null);
    setHasSubmitted(false);
    setWarnings([]);
    setFormError(null);
  }

  function handleClose(): void {
    if (create.isPending) return;
    reset();
    onClose();
  }

  function getPersonName(): string | null {
    if (personId === viewer.id) return null;
    const picked = staff.data?.find((member) => member.id === personId);
    return person?.name ?? picked?.name ?? null;
  }

  function showFailure(error: unknown): void {
    const failure = readTimeOffFailure(error);
    if (failure.kind === "field" && (failure.field !== "person" || hasPicker)) {
      setServerError({ field: failure.field, message: failure.message });
      setFocusRequest((count) => count + 1);
    } else {
      // No For field to point at when the person is fixed.
      setFormError(
        failure.kind === "field" ? FORM_COPY.archived : failure.message,
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (create.isPending) return;

    const found = validateTimeOff(values, mode, getTodayKey());
    setHasSubmitted(true);
    setClientErrors(found);
    setServerError(null);
    setFormError(null);
    if (personId === null || Object.keys(found).length > 0) {
      setFocusRequest((count) => count + 1);
      return;
    }

    try {
      const result = await create.mutateAsync({
        userId: personId,
        body: buildTimeOffBody(values, warnings),
      });
      if (result.kind === "warning") {
        setWarnings(result.warnings);
      } else {
        showToast({
          tone: "success",
          message: getSuccessMessage(mode, result.item, getPersonName()),
        });
        reset();
        onClose();
        onCreated(result.item);
      }
    } catch (error) {
      showFailure(error);
    }
  }

  let picker: StaffPickerState | null = null;
  if (hasPicker && staff.data) {
    picker = {
      kind: "ready",
      options: staff.data.map((member) => ({
        value: member.id,
        label: member.id === viewer.id ? `${member.name} (you)` : member.name,
        description: roleLabel(member.role),
        hasAvatar: true,
      })),
    };
  } else if (hasPicker && staff.isError) {
    picker = {
      kind: "error",
      isRetrying: staff.isFetching,
      onRetry: () => void staff.refetch(),
    };
  } else if (hasPicker) {
    picker = { kind: "loading" };
  }

  return {
    values,
    errors,
    warnings,
    formError,
    isSaving: create.isPending,
    picker,
    formRef,
    wellRef,
    pickPerson,
    changeField,
    handleBlur,
    handleSubmit,
    handleClose,
  };
}
