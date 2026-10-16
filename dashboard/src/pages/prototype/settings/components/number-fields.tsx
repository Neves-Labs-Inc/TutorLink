// Number inputs with meaning: a duration (amount + unit) and a small
// count with − / + buttons. Both write the stored base value.
import { useState } from "react";
import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import { IconButton } from "@/components/kit/components/button";
import { cn } from "@/components/kit/tokens";
import FieldFrame, {
  SelectControl,
} from "@/pages/prototype/settings/components/field-frame";
import { getControlClasses } from "@/pages/prototype/settings/lib/control-classes";
import {
  joinDuration,
  splitDuration,
} from "@/pages/prototype/settings/lib/units";
import type { Unit } from "@/pages/prototype/settings/lib/units";

type DurationFieldProps = {
  label: string;
  help?: ReactNode;
  error?: string;
  isChanged?: boolean;
  note?: ReactNode;
  value: string;
  units: Unit[];
  onChange: (value: string) => void;
  isDisabled?: boolean;
};

export function DurationField({
  label,
  help,
  error,
  isChanged,
  note,
  value,
  units,
  onChange,
  isDisabled = false,
}: DurationFieldProps): ReactNode {
  // The unit is the person's choice; keep it while they type.
  const [unitId, setUnitId] = useState(() => splitDuration(value, units).unitId);
  const [typed, setTyped] = useState(() => splitDuration(value, units).amount);
  // What they typed, unless the value changed from outside (Discard).
  const isTypedCurrent = joinDuration({ amount: typed, unitId }, units) === value;
  const amount = isTypedCurrent ? typed : getAmount(value, unitId, units);
  const isOne = amount === "1";

  function handleAmountChange(next: string): void {
    setTyped(next);
    onChange(joinDuration({ amount: next, unitId }, units));
  }

  function handleUnitChange(nextId: string): void {
    setUnitId(nextId);
    setTyped(amount);
    onChange(joinDuration({ amount, unitId: nextId }, units));
  }

  return (
    <FieldFrame
      label={label}
      help={help}
      error={error}
      isChanged={isChanged}
      note={note}
    >
      {({ controlId, describedBy }) => (
        <div className="flex max-w-[320px] gap-2">
          <input
            id={controlId}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={amount}
            disabled={isDisabled}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            onChange={(event) => handleAmountChange(event.target.value)}
            className={cn(getControlClasses(Boolean(error)), "w-24 px-4 text-right tabular-nums")}
          />
          <SelectControl
            aria-label={`${label}, unit`}
            label={`${label}, unit`}
            value={unitId}
            disabled={isDisabled}
            onChange={(event) => handleUnitChange(event.target.value)}
            options={units.map((option) => ({
              value: option.id,
              label: isOne ? option.one : option.many,
            }))}
            className="flex-1"
          />
        </div>
      )}
    </FieldFrame>
  );
}

function getAmount(value: string, unitId: string, units: Unit[]): string {
  const unit = units.find((option) => option.id === unitId) ?? units[0];
  const base = Number(value);
  return Number.isFinite(base) && value.trim() !== ""
    ? String(base / unit.factor)
    : value;
}

type StepperFieldProps = {
  label: string;
  help?: ReactNode;
  error?: string;
  isChanged?: boolean;
  value: string;
  min: number;
  max?: number;
  suffix: string;
  onChange: (value: string) => void;
};

export function StepperField({
  label,
  help,
  error,
  isChanged,
  value,
  min,
  max,
  suffix,
  onChange,
}: StepperFieldProps): ReactNode {
  const number = Number(value);
  const isNumber = Number.isInteger(number);
  return (
    <FieldFrame label={label} help={help} error={error} isChanged={isChanged}>
      {({ controlId, describedBy }) => (
        <div className="flex items-center gap-2">
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
            className={cn(getControlClasses(Boolean(error)), "w-20 px-3 text-center tabular-nums")}
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
