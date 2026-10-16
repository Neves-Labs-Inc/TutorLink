// A password input with a Show/Hide toggle, styled like the kit's
// TextField (the kit has no password field; listed as a kit change).
// Paste and password managers are never blocked (WCAG 3.3.8).
import { useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";

type PasswordFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  label: string;
  help?: string;
  error?: string;
  autoComplete: "current-password" | "new-password";
};

export default function PasswordField({
  label,
  help,
  error,
  className,
  ...rest
}: PasswordFieldProps): ReactNode {
  const id = useId();
  const messageId = `${id}-message`;
  const [isVisible, setIsVisible] = useState(false);
  const message = error ?? help;
  const ToggleIcon = isVisible ? EyeOff : Eye;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[14px] leading-5 font-semibold text-(--tl-ink)"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={isVisible ? "text" : "password"}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            "h-11 w-full rounded-full border bg-(--tl-surface) pr-[92px] pl-4 text-[15px] text-(--tl-ink) transition-colors duration-150 placeholder:text-(--tl-muted) disabled:cursor-not-allowed disabled:border-(--tl-border) disabled:bg-(--tl-surface-sunk) disabled:text-(--tl-muted)",
            error
              ? "border-(--tl-danger)"
              : "border-(--tl-field-border) hover:border-(--tl-primary)",
            className,
          )}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          aria-pressed={isVisible}
          aria-controls={id}
          disabled={rest.disabled}
          className="absolute top-0 right-0 inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-(--tl-link) hover:bg-(--tl-tint) disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ToggleIcon aria-hidden className="size-4" />
          {isVisible ? "Hide" : "Show"}
        </button>
      </div>
      {message && (
        <p
          id={messageId}
          className={cn(
            "flex items-start gap-1.5 px-1 text-[13px] leading-[18px]",
            error ? "font-medium text-(--tl-danger)" : "text-(--tl-muted)",
          )}
        >
          {error && <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />}
          {message}
        </p>
      )}
    </div>
  );
}
