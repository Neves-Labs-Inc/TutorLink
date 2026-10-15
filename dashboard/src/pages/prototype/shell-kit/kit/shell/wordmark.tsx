import type { ReactNode } from "react";
import { HandHeart } from "lucide-react";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";

type WordmarkProps = { isCompact?: boolean };

export function Wordmark({ isCompact = false }: WordmarkProps): ReactNode {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-(--tl-hero) text-(--tl-on-hero)",
          isCompact ? "size-9" : "size-11",
        )}
      >
        <HandHeart className={isCompact ? "size-5" : "size-6"} />
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        <span
          className={cn(
            "kit-display font-light whitespace-nowrap text-(--tl-ink) uppercase",
            isCompact
              ? "text-[14px] tracking-[0.06em]"
              : "text-[15px] tracking-[0.03em]",
          )}
        >
          M&rsquo;s Helping Hands
        </span>
        {!isCompact && (
          <span className="mt-1.5 text-[12px] font-medium text-(--tl-muted)">
            TutorLink
          </span>
        )}
      </span>
    </div>
  );
}
