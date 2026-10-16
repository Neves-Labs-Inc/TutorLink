// The email button colour: four brand presets plus any colour, as a
// picker and a typed code. Lives in the email editor.
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import FieldFrame from "@/pages/prototype/settings/components/field-frame";
import { getControlClasses } from "@/pages/prototype/settings/lib/control-classes";
import {
  BRAND_COLOR_PRESETS,
  cleanBrandColor,
  isPresetSelected,
  validateBrandColor,
} from "@/lib/settings/emailTemplates";

const FALLBACK_COLOUR = "#74C8C9";

type ColourPickerProps = {
  value: string;
  isChanged: boolean;
  onChange: (value: string) => void;
};

export default function ColourPicker({
  value,
  isChanged,
  onChange,
}: ColourPickerProps): ReactNode {
  const error = validateBrandColor(cleanBrandColor(value)) ?? undefined;
  return (
    <FieldFrame
      label="Button colour"
      help={error ? undefined : "Shared by the Invite and Password reset emails."}
      error={error}
      isChanged={isChanged}
      isGroup
    >
      {() => (
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
                    : "border-(--tl-border) hover:border-(--tl-primary)",
                )}
              >
                <span
                  className="inline-flex size-9 items-center justify-center rounded-full text-[#14212E]"
                  style={{ backgroundColor: preset.hex }}
                >
                  {isSelected && <Check aria-hidden className="size-4" />}
                </span>
                {preset.name}
              </button>
            );
          })}
          <span className="flex items-center gap-2">
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
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className={cn(getControlClasses(Boolean(error)), "w-32 px-4 font-mono uppercase")}
            />
          </span>
        </div>
      )}
    </FieldFrame>
  );
}
