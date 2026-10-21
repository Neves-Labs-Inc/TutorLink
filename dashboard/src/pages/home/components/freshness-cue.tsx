// Home refetches on focus and every 60s, with no push (TutorLink#189). A
// quiet "Updated" time says how fresh it is; a failed refresh keeps the
// data and says so instead of blanking the page.
import type { ReactNode } from "react";
import { CloudOff, RotateCw } from "lucide-react";
import { TextLink } from "@/components/kit/components/button";
import { formatUpdatedAt } from "@/components/kit/format";
import { cn } from "@/components/kit/tokens";
import type { Freshness } from "@/pages/home/hooks/use-home-data";

type FreshnessCueProps = { freshness: Freshness };

export default function FreshnessCue({
  freshness,
}: FreshnessCueProps): ReactNode {
  if (!freshness.updatedAt) return null;

  const updated = formatUpdatedAt(freshness.updatedAt);
  return freshness.isStale ? (
    <span
      role="status"
      className="inline-flex items-center gap-2 rounded-full bg-(--tl-warning-tint) pl-3 text-[13px] font-medium text-(--tl-warning)"
    >
      <CloudOff aria-hidden className="size-4 shrink-0" />
      Couldn’t refresh. Showing {updated}.
      <TextLink
        onClick={freshness.retry}
        disabled={freshness.isRetrying}
        className="my-0 px-3 text-(--tl-warning)!"
      >
        <RotateCw
          aria-hidden
          className={cn(
            "size-4",
            freshness.isRetrying && "animate-spin motion-reduce:animate-none",
          )}
        />
        Retry
      </TextLink>
    </span>
  ) : (
    <span className="text-[13px] text-(--tl-muted) tabular-nums">
      Updated {updated}
    </span>
  );
}
