// Label, help or error, and a "Changed" tag for one setting. Matches the
// kit's FieldShell (which isn't exported), plus the tag, so an Admin can
// see which fields an unsaved change touches.
import { useId } from "react";
import type { ComponentProps, ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import Select from "@/pages/prototype/shell-kit/kit/components/select";

export type FieldIds = { controlId: string; describedBy: string | undefined };

type FieldFrameProps = {
  label: string;
  help?: ReactNode;
  error?: string;
  isChanged?: boolean;
  note?: ReactNode;
  // A fieldset groups a number and its unit under one legend.
  isGroup?: boolean;
  children: (ids: FieldIds) => ReactNode;
};

export default function FieldFrame({
  label,
  help,
  error,
  isChanged = false,
  note,
  isGroup = false,
  children,
}: FieldFrameProps): ReactNode {
  const controlId = useId();
  const messageId = `${controlId}-message`;
  const message = error ?? help;
  const labelClass = "text-[14px] leading-5 font-semibold text-(--tl-ink)";
  const heading = (
    <span className="flex flex-wrap items-center gap-2">
      {isGroup ? (
        <span id={`${controlId}-label`} className={labelClass}>
          {label}
        </span>
      ) : (
        <label htmlFor={controlId} className={labelClass}>
          {label}
        </label>
      )}
      {isChanged && <ChangedTag />}
      {note}
    </span>
  );
  const body = children({
    controlId,
    describedBy: message ? messageId : undefined,
  });
  return (
    <div
      role={isGroup ? "group" : undefined}
      aria-labelledby={isGroup ? `${controlId}-label` : undefined}
      className="flex flex-col gap-1.5"
    >
      {heading}
      {body}
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
    </div>
  );
}

function ChangedTag(): ReactNode {
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full bg-(--tl-yellow-tint) px-2 text-[11px] font-semibold text-(--tl-yellow-ink)">
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      Changed
    </span>
  );
}

type SelectControlProps = Omit<ComponentProps<typeof Select>, "variant" | "aria-invalid"> & {
  hasError?: boolean;
};

// className sizes the wrapper (width caps), so the chevron stays on the trigger.
export function SelectControl({
  hasError = false,
  className,
  ...rest
}: SelectControlProps): ReactNode {
  return (
    <div className={className}>
      <Select variant="field" aria-invalid={hasError} {...rest} />
    </div>
  );
}
