// Title block of every auth page: optional status icon, thin Lato title,
// one or two lines of body. The title is the page's only h1.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import type { AuthPageContent } from "@/pages/prototype/auth/lib/auth-page-content";

const ICON_TONES: Record<NonNullable<AuthPageContent["iconTone"]>, string> = {
  primary: "bg-(--tl-tint-strong) text-(--tl-primary-ink)",
  success: "bg-(--tl-success-tint) text-(--tl-success)",
  warning: "bg-(--tl-warning-tint) text-(--tl-warning)",
  danger: "bg-(--tl-danger-tint) text-(--tl-danger)",
};

type AuthHeadingProps = {
  icon?: LucideIcon;
  iconTone?: AuthPageContent["iconTone"];
  title: string;
  body?: ReactNode;
  isCentered?: boolean;
  isLarge?: boolean;
};

export default function AuthHeading({
  icon: Icon,
  iconTone = "primary",
  title,
  body,
  isCentered = false,
  isLarge = false,
}: AuthHeadingProps): ReactNode {
  return (
    <header className={cn("flex flex-col gap-2", isCentered && "items-center text-center")}>
      {Icon && (
        <span
          aria-hidden
          className={cn(
            "mb-2 inline-flex size-12 items-center justify-center rounded-full",
            ICON_TONES[iconTone],
          )}
        >
          <Icon className="size-6" />
        </span>
      )}
      <h1
        className={cn(
          "kit-display font-light tracking-[-0.01em] text-(--tl-ink)",
          isLarge
            ? "text-[34px] leading-[42px] @5xl:text-[44px] @5xl:leading-[52px]"
            : "text-[30px] leading-[38px] @5xl:text-[34px] @5xl:leading-[42px]",
        )}
      >
        {title}
      </h1>
      {body && (
        <div className="text-[15px] leading-6 text-(--tl-muted)">{body}</div>
      )}
    </header>
  );
}
