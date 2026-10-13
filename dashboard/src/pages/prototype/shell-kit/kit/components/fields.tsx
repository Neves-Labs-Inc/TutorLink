// Form fields. Each takes `label`, optional `help` and `error`, and wires
// the label, description and error ids itself; the rest of the props go
// to the native element. Errors replace the help text and say what to do.
import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { ChevronDown, CircleAlert, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";

const CONTROL =
  "w-full border bg-(--tl-surface) text-[15px] text-(--tl-ink) transition-colors duration-150 placeholder:text-(--tl-muted) disabled:cursor-not-allowed disabled:border-(--tl-border) disabled:bg-(--tl-surface-sunk) disabled:text-(--tl-muted)";

function getControlClasses(hasError: boolean): string {
  return cn(
    CONTROL,
    hasError
      ? "border-(--tl-danger) hover:border-(--tl-danger)"
      : "border-(--tl-field-border) hover:border-(--tl-primary)",
  );
}

type FieldIds = { controlId: string; describedBy: string | undefined };

type FieldShellProps = {
  label: string;
  help?: string;
  error?: string;
  isRequired?: boolean;
  isLabelHidden?: boolean;
  children: (ids: FieldIds) => ReactNode;
};

function FieldShell({
  label,
  help,
  error,
  isRequired = false,
  isLabelHidden = false,
  children,
}: FieldShellProps): ReactNode {
  const controlId = useId();
  const messageId = `${controlId}-message`;
  const message = error ?? help;
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={controlId}
        className={cn(
          "text-[14px] leading-5 font-semibold text-(--tl-ink)",
          isLabelHidden && "sr-only",
        )}
      >
        {label}
        {isRequired ? (
          <span className="font-normal text-(--tl-muted)"> (required)</span>
        ) : null}
      </label>
      {children({ controlId, describedBy: message ? messageId : undefined })}
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
          {message}
        </p>
      )}
    </div>
  );
}

type SharedFieldProps = {
  label: string;
  help?: string;
  error?: string;
  isLabelHidden?: boolean;
};

type TextFieldProps = SharedFieldProps &
  InputHTMLAttributes<HTMLInputElement> & { icon?: LucideIcon };

// Text, email, tel, number, date and time all use this; the native
// pickers follow the theme through `color-scheme` on the kit root.
export function TextField({
  label,
  help,
  error,
  isLabelHidden,
  icon: Icon,
  required,
  className,
  ...rest
}: TextFieldProps): ReactNode {
  return (
    <FieldShell
      label={label}
      help={help}
      error={error}
      isRequired={required}
      isLabelHidden={isLabelHidden}
    >
      {({ controlId, describedBy }) => (
        <div className="relative">
          {Icon && (
            <Icon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-(--tl-muted)"
            />
          )}
          <input
            id={controlId}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            required={required}
            className={cn(
              getControlClasses(Boolean(error)),
              "h-11 rounded-full px-4",
              Icon && "pl-11",
              className,
            )}
            {...rest}
          />
        </div>
      )}
    </FieldShell>
  );
}

type TextAreaFieldProps = SharedFieldProps &
  TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextAreaField({
  label,
  help,
  error,
  isLabelHidden,
  required,
  className,
  rows = 4,
  ...rest
}: TextAreaFieldProps): ReactNode {
  return (
    <FieldShell
      label={label}
      help={help}
      error={error}
      isRequired={required}
      isLabelHidden={isLabelHidden}
    >
      {({ controlId, describedBy }) => (
        <textarea
          id={controlId}
          rows={rows}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          required={required}
          className={cn(
            getControlClasses(Boolean(error)),
            "min-h-28 resize-y rounded-[20px] px-4 py-3 leading-6",
            className,
          )}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

export type SelectOption = { value: string; label: string };

type SelectFieldProps = SharedFieldProps &
  SelectHTMLAttributes<HTMLSelectElement> & { options: SelectOption[] };

export function SelectField({
  label,
  help,
  error,
  isLabelHidden,
  options,
  required,
  className,
  ...rest
}: SelectFieldProps): ReactNode {
  return (
    <FieldShell
      label={label}
      help={help}
      error={error}
      isRequired={required}
      isLabelHidden={isLabelHidden}
    >
      {({ controlId, describedBy }) => (
        <div className="relative">
          <select
            id={controlId}
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            required={required}
            className={cn(
              getControlClasses(Boolean(error)),
              "h-11 cursor-pointer rounded-full pr-11 pl-4",
              className,
            )}
            {...rest}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-1/2 right-4 size-[18px] -translate-y-1/2 text-(--tl-muted)"
          />
        </div>
      )}
    </FieldShell>
  );
}

type SearchInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

// A search box with a hidden label (the placeholder is not the label) and
// a clear button once there is text.
export function SearchInput({
  label,
  value,
  onChange,
  placeholder,
  className,
}: SearchInputProps): ReactNode {
  const id = useId();
  return (
    <div className={cn("relative", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-(--tl-muted)"
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          getControlClasses(false),
          "h-11 rounded-full pr-11 pl-11 [&::-webkit-search-cancel-button]:hidden",
        )}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-0 right-0 inline-flex size-11 cursor-pointer items-center justify-center rounded-full text-(--tl-muted) hover:text-(--tl-ink)"
        >
          <X aria-hidden className="size-[18px]" />
        </button>
      )}
    </div>
  );
}
