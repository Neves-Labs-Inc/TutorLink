// Switches, checkboxes and radio cards. The whole row is
// the hit area (≥44px), not just the little control.
import { useId } from "react";
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/components/kit/tokens";

type SwitchFieldProps = {
  label: string;
  description?: string;
  isOn: boolean;
  onChange: (isOn: boolean) => void;
  isDisabled?: boolean;
};

export function SwitchField({
  label,
  description,
  isOn,
  onChange,
  isDisabled = false,
}: SwitchFieldProps): ReactNode {
  const id = useId();
  return (
    <div className="flex min-h-11 items-center justify-between gap-4">
      <div className="min-w-0">
        <label
          htmlFor={id}
          className="block cursor-pointer text-[15px] leading-6 font-medium"
        >
          {label}
        </label>
        {description && (
          <p
            id={`${id}-description`}
            className="text-[13px] leading-[18px] text-(--tl-muted)"
          >
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={isOn}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={isDisabled}
        onClick={() => onChange(!isOn)}
        className="group inline-flex h-11 w-[60px] shrink-0 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span
          className={cn(
            "relative inline-flex h-8 w-[52px] items-center rounded-full border-2 transition-colors duration-150",
            isOn
              ? "border-(--tl-primary) bg-(--tl-primary)"
              : "border-(--tl-field-border) bg-(--tl-surface-sunk)",
          )}
        >
          <span
            className={cn(
              "absolute size-6 rounded-full transition-transform duration-150",
              isOn
                ? "translate-x-[22px] bg-(--tl-on-primary)"
                : "translate-x-[2px] bg-(--tl-field-border)",
            )}
          />
        </span>
      </button>
    </div>
  );
}

type CheckboxFieldProps = {
  label: string;
  description?: string;
  isChecked: boolean;
  onChange: (isChecked: boolean) => void;
};

export function CheckboxField({
  label,
  description,
  isChecked,
  onChange,
}: CheckboxFieldProps): ReactNode {
  return (
    // The whole row is the label, so a click or tap anywhere on it (text and
    // count included) toggles; the native checkbox keeps Space working.
    <label className="-mx-2 flex min-h-11 w-[calc(100%+16px)] cursor-pointer items-start gap-3 rounded-[14px] px-2 py-2.5 transition-colors duration-150 select-none hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)">
      <span className="relative mt-0.5 inline-flex size-5 shrink-0">
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer size-5 cursor-pointer appearance-none rounded-[6px] border-2 border-(--tl-field-border) bg-(--tl-surface) checked:border-(--tl-primary) checked:bg-(--tl-primary)"
        />
        <Check
          aria-hidden
          strokeWidth={3}
          className="pointer-events-none absolute inset-0.5 size-4 text-(--tl-on-primary) opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] leading-6 font-medium">
          {label}
        </span>
        {description && (
          <span className="block text-[13px] leading-[18px] text-(--tl-muted)">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

export type RadioOption = { value: string; label: string; description?: string };

type RadioCardsProps = {
  legend: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  isHorizontal?: boolean;
};

// A short set of exclusive choices shown as tappable cards.
export function RadioCards({
  legend,
  options,
  value,
  onChange,
  isHorizontal = false,
}: RadioCardsProps): ReactNode {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-[14px] leading-5 font-semibold">
        {legend}
      </legend>
      <div
        className={cn(
          "grid gap-2",
          isHorizontal && "@2xl:grid-cols-3",
        )}
      >
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <label
              key={option.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-[16px] border px-4 py-3 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--tl-focus)",
                isSelected
                  ? "border-(--tl-primary) bg-(--tl-tint)"
                  : "border-(--tl-border) bg-(--tl-surface) hover:border-(--tl-primary)",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={isSelected}
                onChange={() => onChange(option.value)}
                className="mt-1 size-[18px] shrink-0 cursor-pointer appearance-none rounded-full border-2 border-(--tl-field-border) bg-(--tl-surface) checked:border-[6px] checked:border-(--tl-primary) focus-visible:outline-none"
              />
              <span className="min-w-0">
                <span className="block text-[15px] leading-6 font-medium">
                  {option.label}
                </span>
                {option.description && (
                  <span className="block text-[13px] leading-[18px] text-(--tl-muted)">
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
