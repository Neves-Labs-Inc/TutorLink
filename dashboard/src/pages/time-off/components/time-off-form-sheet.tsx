// Request time off (Tutors, Managers, for themselves: lands Pending) and
// Add time off (Admins, for anyone: takes effect straight away). A bottom
// sheet on phones, a centred card from 672px. Keep it mounted and drive
// it with isOpen; closing resets it.
import { useId } from "react";
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { SwitchField } from "@/components/kit/components/choices";
import { Combobox } from "@/components/kit/components/combobox";
import { TextAreaField, TextField } from "@/components/kit/components/fields";
import { getTodayKey } from "@/components/kit/format";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import {
  FormAlert,
  InlineError,
  Skeleton,
} from "@/components/kit/states/states";
import type { ExceptionRead, NamedRef } from "@/lib/queries/time-off";
import TimeOffClashWarning from "@/pages/time-off/components/time-off-clash-warning";
import { useTimeOffForm } from "@/pages/time-off/hooks/use-time-off-form";
import type { StaffPickerState } from "@/pages/time-off/hooks/use-time-off-form";
import { getFirstName } from "@/pages/time-off/lib/time-off-copy";
import type { TimeOffFormMode } from "@/pages/time-off/lib/time-off-form";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";

const FORM_ID = "time-off-form";
const REASON_MAX_LENGTH = 500;
// The kit field label and error line, for the For field's stand-ins
// while the Staff list loads or fails.
const FIELD_LABEL = "text-[14px] leading-5 font-semibold text-(--tl-ink)";
const FIELD_ERROR =
  "flex items-start gap-1.5 px-1 text-[13px] leading-[18px] font-medium text-(--tl-danger)";

type TimeOffFormSheetProps = {
  isOpen: boolean;
  mode: TimeOffFormMode;
  viewer: Viewer;
  // Fixes who it's for and hides the picker (the Staff details tab).
  person?: NamedRef | null;
  onClose: () => void;
  onCreated: (item: ExceptionRead) => void;
};

function getTitle(mode: TimeOffFormMode, person: NamedRef | null): string {
  let title = "Request time off";
  if (mode === "add") {
    title = person ? `Add time off for ${getFirstName(person.name)}` : "Add time off";
  }
  return title;
}

type PersonFieldProps = {
  picker: StaffPickerState;
  value: string | null;
  error?: string;
  onChange: (id: string) => void;
};

function PersonField({
  picker,
  value,
  error,
  onChange,
}: PersonFieldProps): ReactNode {
  const labelId = useId();
  const errorId = useId();
  if (picker.kind !== "ready") {
    // No Combobox yet, so the group carries the error and takes the focus
    // a failed submit moves to the first invalid field.
    return (
      <div
        role="group"
        aria-labelledby={labelId}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        tabIndex={-1}
        className="flex flex-col gap-1.5 outline-none"
      >
        <span id={labelId} className={FIELD_LABEL}>
          For<span className="font-normal text-(--tl-muted)"> (required)</span>
        </span>
        {picker.kind === "loading" ? (
          <div role="status" aria-label="Loading Staff">
            <Skeleton className="h-11 w-full rounded-full" />
          </div>
        ) : (
          <InlineError
            message="Couldn’t load Staff. Check your connection and try again."
            onRetry={picker.onRetry}
            isRetrying={picker.isRetrying}
          />
        )}
        {error && (
          <p id={errorId} className={FIELD_ERROR}>
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <Combobox
      label="For"
      placeholder="Search Staff"
      isRequired
      options={picker.options}
      value={value}
      onChange={onChange}
      error={error}
    />
  );
}

export default function TimeOffFormSheet({
  isOpen,
  mode,
  viewer,
  person = null,
  onClose,
  onCreated,
}: TimeOffFormSheetProps): ReactNode {
  // Destructured: the compiler lint reads any property of an object that
  // holds refs as a ref read during render.
  const {
    values,
    errors,
    warnings,
    formError,
    isSaving,
    picker,
    formRef,
    wellRef,
    pickPerson,
    changeField,
    handleBlur,
    handleSubmit,
    handleClose,
  } = useTimeOffForm({ isOpen, mode, viewer, person, onClose, onCreated });
  const isAdd = mode === "add";
  const hasWarnings = warnings.length > 0;
  let submitLabel = isAdd ? "Add time off" : "Send request";
  if (hasWarnings) submitLabel = "Add anyway";

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={handleClose}
      title={getTitle(mode, person)}
      description={
        isAdd
          ? "Takes effect straight away, with no approval."
          : "An Admin approves or declines it. You’ll see the answer on Time off."
      }
      footer={
        <>
          <Button onClick={handleClose} disabled={isSaving}>
            Not now
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={FORM_ID}
            isLoading={isSaving}
          >
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        id={FORM_ID}
        // The sheet focuses the first field on open.
        data-autofocus
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        onBlur={handleBlur}
      >
        <fieldset disabled={isSaving} className="flex min-w-0 flex-col gap-4">
          {picker && (
            <PersonField
              picker={picker}
              value={values.personId}
              error={errors.person}
              onChange={pickPerson}
            />
          )}
          <div className="grid gap-4 @md:grid-cols-2">
            <TextField
              label="First day"
              type="date"
              required
              min={isAdd ? undefined : getTodayKey()}
              value={values.first}
              onChange={(event) => changeField({ first: event.target.value })}
              error={errors.first}
            />
            <TextField
              label="Last day"
              type="date"
              min={values.first || undefined}
              value={values.last}
              onChange={(event) => changeField({ last: event.target.value })}
              help="Leave empty for one day."
              error={errors.last}
            />
          </div>
          <SwitchField
            label="Only part of the day"
            description="The same hours on each day."
            isOn={values.isPartDay}
            onChange={(isOn) => changeField({ isPartDay: isOn })}
            isDisabled={isSaving}
          />
          {values.isPartDay && (
            <div className="kit-rise grid grid-cols-2 gap-4 motion-reduce:animate-none">
              <TextField
                label="From"
                type="time"
                value={values.from}
                onChange={(event) => changeField({ from: event.target.value })}
              />
              <TextField
                label="To"
                type="time"
                value={values.to}
                onChange={(event) => changeField({ to: event.target.value })}
                error={errors.to}
              />
            </div>
          )}
          <TextAreaField
            label="Reason"
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            value={values.reason}
            onChange={(event) => changeField({ reason: event.target.value })}
            help={
              isAdd
                ? "Optional. The person sees it too."
                : "Optional. Admins see it with your request."
            }
          />
          {hasWarnings && (
            <TimeOffClashWarning warnings={warnings} wellRef={wellRef} />
          )}
          {formError && (
            <FormAlert tone="danger" title={formError} />
          )}
        </fieldset>
      </form>
    </BottomSheet>
  );
}
