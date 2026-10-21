// An email's button colour: the four brand presets, any colour from the
// picker, or a typed code. Swatch fills are data, not design colours.
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { FieldFrame } from "@/components/kit/components/settings-form";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { cn } from "@/components/kit/tokens";
import {
  BRAND_COLOR_PRESETS,
  cleanBrandColor,
  isPresetSelected,
  validateBrandColor,
} from "@/lib/settings/emailTemplates";

const FALLBACK_COLOUR = "#74C8C9";
// Room for a pasted CSS declaration like "#74C8C9; "; cleaning trims it.
const HEX_MAX_LENGTH = 32;
// The labels on the presets are the brand's light colours, so ink is fixed.
const SWATCH_INK = "text-[#14212E]";

type EmailColourPickerProps = {
  value: string;
  isChanged: boolean;
  onChange: (value: string) => void;
};

export default function EmailColourPicker({
  value,
  isChanged,
  onChange,
}: EmailColourPickerProps): ReactNode {
  const error = validateBrandColor(cleanBrandColor(value)) ?? undefined;
  return (
    <FieldFrame
      isGroup
      label="Button colour"
      help="The button in this email. Shown in Preview straight away."
      error={error}
      isChanged={isChanged}
    >
      {({ describedBy }) => (
        <div className="flex flex-wrap items-center gap-2">
          {BRAND_COLOR_PRESETS.map((preset) => {
            const isSelected = isPresetSelected(preset, value);
            return (
              <button
                key={preset.hex}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onChange(preset.hex)}
                className={cn(
                  "flex h-11 cursor-pointer items-center gap-2 rounded-full border py-1 pr-4 pl-1 text-[14px] font-medium transition-colors duration-150",
                  isSelected
                    ? "border-(--tl-primary) bg-(--tl-tint)"
                    : "border-(--tl-border) bg-(--tl-surface) hover:border-(--tl-primary)",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-9 items-center justify-center rounded-full",
                    SWATCH_INK,
                  )}
                  style={{ backgroundColor: preset.hex }}
                >
                  {isSelected && <Check aria-hidden className="size-4" />}
                </span>
                {preset.name}
              </button>
            );
          })}
          <input
            type="color"
            aria-label="Pick any colour"
            value={error ? FALLBACK_COLOUR : cleanBrandColor(value)}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="size-11 cursor-pointer rounded-full border border-(--tl-border) bg-transparent p-1"
          />
          <input
            type="text"
            aria-label="Colour code"
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            spellCheck={false}
            maxLength={HEX_MAX_LENGTH}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={cn(
              getControlClasses(Boolean(error)),
              "h-11 w-32! rounded-full px-4 font-mono uppercase",
            )}
          />
        </div>
      )}
    </FieldFrame>
  );
}
