// Buttons: every one is a 44px pill (or 44px circle for icon-only), so
// tap targets never shrink. One primary per view; Danger confirms only.
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  MouseEvent,
  ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/kit/tokens";

export type ButtonVariant =
  | "primary"
  | "soft"
  | "outline"
  | "ghost"
  | "danger"
  | "danger-outline";

const BASE =
  "inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "kit-shadow-soft bg-(--tl-primary) text-(--tl-on-primary) not-aria-disabled:hover:enabled:bg-(--tl-primary-hover) not-aria-disabled:enabled:active:bg-(--tl-primary-hover)",
  soft: "bg-(--tl-tint) text-(--tl-primary-ink) not-aria-disabled:hover:enabled:bg-(--tl-tint-strong) not-aria-disabled:enabled:active:bg-(--tl-tint-strong)",
  outline:
    "border border-(--tl-border) bg-(--tl-surface) text-(--tl-ink) not-aria-disabled:hover:enabled:bg-(--tl-tint) not-aria-disabled:enabled:active:bg-(--tl-tint-strong)",
  ghost: "text-(--tl-link) not-aria-disabled:hover:enabled:bg-(--tl-tint) not-aria-disabled:enabled:active:bg-(--tl-tint-strong)",
  danger:
    "bg-(--tl-danger) text-(--tl-on-danger) not-aria-disabled:hover:enabled:bg-(--tl-danger-hover) not-aria-disabled:enabled:active:bg-(--tl-danger-hover)",
  "danger-outline":
    "border border-(--tl-border) bg-(--tl-surface) text-(--tl-danger) not-aria-disabled:hover:enabled:bg-(--tl-danger-tint) not-aria-disabled:enabled:active:bg-(--tl-danger-tint) not-aria-disabled:enabled:active:border-(--tl-danger)",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  isLoading?: boolean;
  isFullWidth?: boolean;
};

export function Button({
  variant = "outline",
  icon: Icon,
  isLoading = false,
  isFullWidth = false,
  className,
  children,
  disabled,
  type = "button",
  onClick,
  ...rest
}: ButtonProps): ReactNode {
  const LeadingIcon = isLoading ? LoaderCircle : Icon;

  // Loading stays focusable (a native `disabled` would drop focus to <body>),
  // so the click, and the form submit it triggers, is swallowed instead.
  function handleClick(event: MouseEvent<HTMLButtonElement>): void {
    if (isLoading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      type={type}
      disabled={disabled}
      aria-disabled={isLoading || undefined}
      aria-busy={isLoading || undefined}
      onClick={handleClick}
      className={cn(
        BASE,
        VARIANT_CLASSES[variant],
        isFullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {LeadingIcon && (
        <LeadingIcon
          aria-hidden
          className={cn("size-[18px] shrink-0", isLoading && "kit-spin")}
        />
      )}
      {children}
    </button>
  );
}

type ButtonLinkVariant = "primary" | "soft" | "outline";

// Links can't be disabled, so these drop Button's `enabled:` guards.
const LINK_VARIANT_CLASSES: Record<ButtonLinkVariant, string> = {
  primary:
    "kit-shadow-soft bg-(--tl-primary) text-(--tl-on-primary) hover:bg-(--tl-primary-hover) active:bg-(--tl-primary-hover)",
  soft: "bg-(--tl-tint) text-(--tl-primary-ink) hover:bg-(--tl-tint-strong) active:bg-(--tl-tint-strong)",
  outline:
    "border border-(--tl-border) bg-(--tl-surface) text-(--tl-ink) hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)",
};

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  icon: LucideIcon;
  variant?: ButtonLinkVariant;
  isFullWidth?: boolean;
};

// A real link (maps, phone dialer, another page) dressed as a Button.
export function ButtonLink({
  icon: Icon,
  variant = "outline",
  isFullWidth = false,
  className,
  children,
  ...rest
}: ButtonLinkProps): ReactNode {
  return (
    <a
      className={cn(
        BASE,
        LINK_VARIANT_CLASSES[variant],
        isFullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className="size-[18px] shrink-0" />
      {children}
    </a>
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  variant?: "plain" | "outline" | "primary";
};

const ICON_VARIANT_CLASSES: Record<
  NonNullable<IconButtonProps["variant"]>,
  string
> = {
  plain:
    "text-(--tl-ink-soft) hover:bg-(--tl-tint) enabled:active:bg-(--tl-tint-strong)",
  outline:
    "border border-(--tl-border) bg-(--tl-surface) text-(--tl-ink-soft) hover:bg-(--tl-tint) enabled:active:bg-(--tl-tint-strong)",
  primary:
    "kit-shadow-soft bg-(--tl-primary) text-(--tl-on-primary) hover:bg-(--tl-primary-hover) enabled:active:bg-(--tl-primary-hover)",
};

export function IconButton({
  icon: Icon,
  label,
  variant = "plain",
  className,
  type = "button",
  ...rest
}: IconButtonProps): ReactNode {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        ICON_VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className="size-5" />
    </button>
  );
}

type TextLinkProps = ButtonHTMLAttributes<HTMLButtonElement>;

// An inline action that reads as a link (e.g. "See all", "Open chat").
// Its hit area pads out to 44px without shifting the text.
export function TextLink({
  className,
  children,
  type = "button",
  ...rest
}: TextLinkProps): ReactNode {
  return (
    <button
      type={type}
      className={cn(
        "-my-2.5 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full text-[14px] font-semibold text-(--tl-link) underline-offset-4 hover:underline",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
