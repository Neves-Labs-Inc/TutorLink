// An <a> that looks like the kit's 44px pill Button. The kit Button only
// renders <button>, and "Get directions" / "Call the office" must be
// real links (maps app, phone dialer). Kit change requested.
import type { AnchorHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/kit/tokens";

const VARIANTS = {
  primary:
    "kit-shadow-soft bg-(--tl-primary) text-(--tl-on-primary) hover:bg-(--tl-primary-hover)",
  soft: "bg-(--tl-tint) text-(--tl-primary-ink) hover:bg-(--tl-tint-strong)",
  outline:
    "border border-(--tl-border) bg-(--tl-surface) text-(--tl-ink) hover:bg-(--tl-tint)",
};

type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  icon: LucideIcon;
  variant?: keyof typeof VARIANTS;
  isFullWidth?: boolean;
};

export default function LinkButton({
  icon: Icon,
  variant = "outline",
  isFullWidth = false,
  className,
  children,
  ...rest
}: LinkButtonProps): ReactNode {
  return (
    <a
      className={cn(
        "inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150",
        VARIANTS[variant],
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
