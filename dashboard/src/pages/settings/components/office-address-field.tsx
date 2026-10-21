// Office address: a short multi-line field. Past 400 characters a live
// count shows how close it is to the 500 the API allows.
import type { ReactNode } from "react";
import { FieldFrame } from "@/components/kit/components/settings-form";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { cn } from "@/components/kit/tokens";
import { MAX_ADDRESS_LENGTH } from "@/lib/settings/setting-rules";
import type { BoundField } from "@/pages/settings/hooks/use-settings-form";

const COUNT_FROM = 400;

type OfficeAddressFieldProps = { field: BoundField; onBlur: () => void };

export default function OfficeAddressField({
  field,
  onBlur,
}: OfficeAddressFieldProps): ReactNode {
  // Counted as the API counts it: without leading or trailing space.
  const length = field.value.trim().length;

  return (
    <FieldFrame
      label="Office address"
      help="Where In office Bookings happen. Leave it empty if there’s no office to visit."
      error={field.error}
      isChanged={field.isChanged}
    >
      {({ controlId, describedBy }) => (
        <div className="flex flex-col gap-1.5">
          <textarea
            id={controlId}
            rows={2}
            autoComplete="off"
            placeholder={"Street, suite\nCity, state ZIP"}
            value={field.value}
            aria-describedby={describedBy}
            aria-invalid={field.error ? true : undefined}
            onChange={(event) => field.onChange(event.target.value)}
            onBlur={onBlur}
            className={cn(
              getControlClasses(Boolean(field.error)),
              "min-h-[72px] resize-y rounded-[20px] px-4 py-2.5 leading-6",
            )}
          />
          {length >= COUNT_FROM && (
            <p
              aria-live="polite"
              className="px-1 text-right text-[13px] leading-[18px] text-(--tl-muted) tabular-nums"
            >
              {length} / {MAX_ADDRESS_LENGTH}
            </p>
          )}
        </div>
      )}
    </FieldFrame>
  );
}
