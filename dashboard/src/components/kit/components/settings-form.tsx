// Settings form pieces: a field shell with a "Changed" tag, and the two
// number fields built on it (a duration and a small count). Numbers are
// stored in one base unit; the screen shows what a person would say.
import { useId, useState } from "react";
import type { ReactNode } from "react";
import { CircleAlert, Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/kit/components/button";
import Select from "@/components/kit/components/select";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { joinDuration, splitDuration } from "@/components/kit/lib/units";
import type { Unit } from "@/components/kit/lib/units";
import { cn, TONE_CLASSES } from "@/components/kit/tokens";

export type FieldIds = {
  // Undefined in group mode: each inner control names itself.
  controlId: string | undefined;
  describedBy: string | undefined;
};

type FieldFrameProps = {
  label: string;
  help?: ReactNode;
  error?: string;
  isChanged?: boolean;
  // Sits beside the label (an InfoTip).
  trailing?: ReactNode;
  // A fieldset groups a number and its unit under one label.
  isGroup?: boolean;
  children: (ids: FieldIds) => ReactNode;
};

const LABEL_CLASSES = "text-[14px] leading-5 font-semibold text-(--tl-ink)";

export function FieldFrame({
  label,
  help,
  error,
  isChanged = false,
  trailing,
  isGroup = false,
  children,
}: FieldFrameProps): ReactNode {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const changedId = `${baseId}-changed`;
  const messageId = `${baseId}-message`;
  const message = error ?? help;
  // The Changed tag joins the description so screen readers hear it.
  const describedBy =
    [isChanged ? changedId : null, message ? messageId : null]
      .filter(Boolean)
      .join(" ") || undefined;
  const Wrapper = isGroup ? "fieldset" : "div";

  return (
    <Wrapper
      aria-labelledby={isGroup ? labelId : undefined}
      className={cn(
        "flex min-w-0 flex-col",
        trailing ? "gap-3" : "gap-1.5",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {isGroup ? (
          <span id={labelId} className={LABEL_CLASSES}>
            {label}
          </span>
        ) : (
          <label htmlFor={baseId} className={LABEL_CLASSES}>
            {label}
          </label>
        )}
        {isChanged && <ChangedTag id={changedId} />}
        {trailing}
      </div>
      {children({ controlId: isGroup ? undefined : baseId, describedBy })}
      {message && (
        <p
          id={messageId}
          className={cn(
            "flex items-start gap-1.5 px-1 text-[13px] leading-[18px]",
            error ? "font-medium text-(--tl-danger)" : "text-(--tl-muted)",
          )}
        >
          {error && (
            <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />
          )}
          <span>{message}</span>
        </p>
      )}
    </Wrapper>
  );
}

function ChangedTag({ id }: { id: string }): ReactNode {
  return (
    <span
      id={id}
      className={cn(
        "kit-pop inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-[12px] leading-none font-semibold",
        TONE_CLASSES.yellow,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      Changed
    </span>
  );
}

type DurationFieldProps = {
  label: string;
  value: string;
  units: Unit[];
  onChange: (value: string) => void;
  help?: ReactNode;
  error?: string;
  isChanged?: boolean;
  trailing?: ReactNode;
  isDisabled?: boolean;
};

export function DurationField({
  label,
  value,
  units,
  onChange,
  help,
  error,
  isChanged,
  trailing,
  isDisabled = false,
}: DurationFieldProps): ReactNode {
  // The unit is the person's choice; keep it while they type.
  const [unitId, setUnitId] = useState(() => splitDuration(value, units).unitId);
  const [typed, setTyped] = useState(() => splitDuration(value, units).amount);
  // What they typed, unless the value changed from outside (Discard).
  const isTypedCurrent = joinDuration({ amount: typed, unitId }, units) === value;
  // An outside change (Discard) shows the value in its natural unit again.
  const outside = splitDuration(value, units);
  const shownUnitId = isTypedCurrent ? unitId : outside.unitId;
  const amount = isTypedCurrent ? typed : outside.amount;
  const isOne = amount === "1";

  function handleAmountChange(next: string): void {
    setUnitId(shownUnitId);
    setTyped(next);
    onChange(joinDuration({ amount: next, unitId: shownUnitId }, units));
  }

  function handleUnitChange(nextId: string): void {
    setUnitId(nextId);
    setTyped(amount);
    onChange(joinDuration({ amount, unitId: nextId }, units));
  }

  return (
    <FieldFrame
      isGroup
      label={label}
      help={help}
      error={error}
      isChanged={isChanged}
      trailing={trailing}
    >
      {({ describedBy }) => (
        <div className="flex max-w-[320px] gap-2">
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            aria-label={label}
            value={amount}
            disabled={isDisabled}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={(event) => handleAmountChange(event.target.value)}
            className={cn(
              getControlClasses(Boolean(error)),
              "h-11 w-24! shrink-0 rounded-full px-4 text-right tabular-nums",
            )}
          />
          <div className="min-w-0 flex-1">
            <Select
              variant="field"
              label={`${label}, unit`}
              aria-label={`${label}, unit`}
              aria-describedby={describedBy}
              aria-invalid={Boolean(error)}
              value={shownUnitId}
              disabled={isDisabled}
              onValueChange={handleUnitChange}
              options={units.map((option) => ({
                value: option.id,
                label: isOne ? option.one : option.many,
              }))}
            />
          </div>
        </div>
      )}
    </FieldFrame>
  );
}

type StepperFieldProps = {
  label: string;
  value: string;
  min: number;
  max?: number;
  suffix: string;
  onChange: (value: string) => void;
  help?: ReactNode;
  error?: string;
  isChanged?: boolean;
  trailing?: ReactNode;
};

export function StepperField({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
  help,
  error,
  isChanged,
  trailing,
}: StepperFieldProps): ReactNode {
  const number = Number(value);
  const isNumber = value.trim() !== "" && Number.isInteger(number);
  return (
    <FieldFrame
      label={label}
      help={help}
      error={error}
      isChanged={isChanged}
      trailing={trailing}
    >
      {({ controlId, describedBy }) => (
        // Wraps so the suffix drops under the stepper in narrow two-up cells instead of overflowing.
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <IconButton
            icon={Minus}
            label={`Fewer ${suffix}`}
            variant="outline"
            disabled={!isNumber || number <= min}
            onClick={() => onChange(String(number - 1))}
          />
          <input
            id={controlId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={value}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={(event) => onChange(event.target.value)}
            className={cn(
              getControlClasses(Boolean(error)),
              "h-11 w-20! shrink-0 rounded-full px-3 text-center tabular-nums",
            )}
          />
          <IconButton
            icon={Plus}
            label={`More ${suffix}`}
            variant="outline"
            disabled={!isNumber || (max !== undefined && number >= max)}
            onClick={() => onChange(String(number + 1))}
          />
          <span className="text-[15px] text-(--tl-muted)">{suffix}</span>
        </div>
      )}
    </FieldFrame>
  );
}
