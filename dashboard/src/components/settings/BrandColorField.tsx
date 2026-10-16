import { useState } from "react";

import {
  CONTROL_HEIGHT,
  ERROR_LINE,
  FADE_IN,
} from "@/components/settings/emailTemplateClasses";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  BRAND_COLOR_PRESETS,
  cleanBrandColor,
  isPresetSelected,
  normalizeBrandColor,
} from "@/lib/settings/emailTemplates";
import { cn } from "@/lib/utils";

type BrandColorFieldProps = {
  id: string;
  name: string;
  label: string;
  // Names the native picker, which has no visible label of its own.
  swatchLabel: string;
  value: string;
  error: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
};

// Room for a pasted CSS declaration like "#74C8C9; "; onChange cleans it down to 7.
// Case is left as typed: rewriting it mid-edit would move the caret to the end.
const HEX_MAX_LENGTH = 32;

const SWATCH_CLASSES =
  "w-14 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1 transition-colors duration-150 ease-out outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0";
// The selected preset gets an outline, so the focus ring (a box-shadow) can still show on top.
// `outline-solid` is needed because `outline-none` sets the outline style to none in Tailwind v4.
const PRESET_CLASSES =
  "size-11 shrink-0 cursor-pointer rounded-lg border border-input transition-[outline-color,border-color,filter,transform] duration-150 ease-out outline-none hover:border-ring hover:brightness-95 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-solid aria-pressed:outline-foreground md:size-10";

export default function BrandColorField({
  id,
  name,
  label,
  swatchLabel,
  value,
  error,
  disabled,
  onChange,
}: BrandColorFieldProps): React.ReactNode {
  // The native picker only takes a valid colour, so it holds the last one while the hex is invalid.
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [lastValid, setLastValid] = useState(value);
  if (error === null && value !== lastValid) {
    setLastValid(value);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="color"
          aria-label={swatchLabel}
          className={cn(CONTROL_HEIGHT, SWATCH_CLASSES)}
          value={normalizeBrandColor(lastValid).toLowerCase()}
          disabled={disabled}
          onChange={(event) =>
            onChange(normalizeBrandColor(event.target.value))
          }
        />
        <Input
          id={id}
          name={name}
          className={cn(CONTROL_HEIGHT, "w-32 font-mono uppercase")}
          maxLength={HEX_MAX_LENGTH}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="characters"
          value={value}
          disabled={disabled}
          aria-invalid={error !== null}
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          onChange={(event) =>
            onChange(cleanBrandColor(event.target.value))
          }
        />
        <div
          role="group"
          aria-label="Preset colours"
          // The divider sets the palette apart from the custom picker.
          className="flex gap-2 sm:border-l sm:border-border sm:pl-2"
        >
          {BRAND_COLOR_PRESETS.map((preset) => (
            <button
              key={preset.hex}
              type="button"
              aria-label={`Use ${preset.name} ${preset.hex}`}
              aria-pressed={isPresetSelected(preset, value)}
              className={PRESET_CLASSES}
              // The palette colour is data, not a design token.
              style={{ backgroundColor: preset.hex }}
              disabled={disabled}
              onClick={() => onChange(preset.hex)}
            />
          ))}
        </div>
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        Used for the TutorLink name, buttons and links in this email.
      </p>
      {error && (
        <p id={errorId} role="alert" className={cn(ERROR_LINE, FADE_IN)}>
          {error}
        </p>
      )}
    </div>
  );
}
