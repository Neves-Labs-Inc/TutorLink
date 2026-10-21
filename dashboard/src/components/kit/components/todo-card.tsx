// One To do group as a card (TutorLink#191): icon, title, waiting count,
// up to 3 rows, then "See all n". Loading shows row-shaped skeletons,
// an error stays inside the card with its own Try again (the kit's
// ErrorState is page-sized), and an empty group says "All clear".
import type { ReactNode } from "react";
import { Check, ChevronRight, RotateCw, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CountBadge } from "@/components/kit/components/badges";
import { TextLink } from "@/components/kit/components/button";
import { Skeleton } from "@/components/kit/states/states";
import { CARD, CARD_TITLE, cn, TONE_CLASSES } from "@/components/kit/tokens";
import type { Tone } from "@/components/kit/tokens";

export type TodoPhase = "loading" | "error" | "ready";

const SKELETON_ROWS = 3;

type TodoCardProps = {
  id: string;
  title: string;
  icon: LucideIcon;
  tone: Tone;
  phase: TodoPhase;
  total: number;
  emptyHint: string;
  seeAllLabel: string;
  onSeeAll: () => void;
  onRetry: () => void;
  isRetrying?: boolean;
  children: ReactNode;
};

export default function TodoCard({
  id,
  title,
  icon: Icon,
  tone,
  phase,
  total,
  emptyHint,
  seeAllLabel,
  onSeeAll,
  onRetry,
  isRetrying = false,
  children,
}: TodoCardProps): ReactNode {
  const headingId = `todo-${id}`;
  const isReady = phase === "ready";
  return (
    <section
      aria-labelledby={headingId}
      className={cn(CARD, "flex min-w-0 flex-col p-4 @2xl:p-5")}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-[14px]",
            TONE_CLASSES[tone],
          )}
        >
          <Icon aria-hidden className="size-[18px]" />
        </span>
        <h3 id={headingId} className={cn(CARD_TITLE, "flex-1")}>
          {title}
        </h3>
        {isReady && total > 0 && (
          <CountBadge count={total} tone="pink" label="waiting" />
        )}
      </div>

      {phase === "loading" && <RowSkeletons title={title} />}
      {phase === "error" && <CardError title={title} onRetry={onRetry} isRetrying={isRetrying} />}
      {isReady && total === 0 && <AllClear hint={emptyHint} />}
      {isReady && total > 0 && (
        <ul className="-mx-2 mt-3">{children}</ul>
      )}

      {isReady && total > 0 && (
        <div className="mt-2 border-t border-(--tl-border) pt-1">
          <TextLink
            onClick={onSeeAll}
            className="group"
            aria-label={`See all ${total} ${seeAllLabel}`}
          >
            See all {total}
            <ChevronRight
              aria-hidden
              className="size-4 transition-transform duration-150 group-hover:translate-x-0.5"
            />
          </TextLink>
        </div>
      )}
    </section>
  );
}

function RowSkeletons({ title }: { title: string }): ReactNode {
  return (
    <div role="status" aria-label={`Loading ${title}`} className="mt-3 flex flex-col gap-4 py-2">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div key={index} className="flex flex-col gap-2 px-0.5">
          <Skeleton className="h-4 w-2/5 rounded-full" />
          <Skeleton className="h-3 w-4/5 rounded-full" />
        </div>
      ))}
    </div>
  );
}

type AllClearProps = { hint: string };

function AllClear({ hint }: AllClearProps): ReactNode {
  return (
    <div className="mt-3 flex items-start gap-3 rounded-[16px] bg-(--tl-surface-sunk) px-4 py-4">
      <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-success)" />
      <p className="text-[14px] leading-5">
        <span className="font-semibold">All clear</span>
        <span className="block text-(--tl-muted)">{hint}</span>
      </p>
    </div>
  );
}

type CardErrorProps = {
  title: string;
  onRetry: () => void;
  isRetrying: boolean;
};

function CardError({ title, onRetry, isRetrying }: CardErrorProps): ReactNode {
  return (
    <div
      role="alert"
      className="mt-3 flex flex-col items-start gap-2 rounded-[16px] bg-(--tl-danger-tint) px-4 py-3 text-(--tl-danger) @md:flex-row @md:items-center"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      <p className="flex-1 text-[14px] leading-5 font-medium">
        Couldn’t load {title.toLowerCase()}. Check your connection and try again.
      </p>
      <TextLink
        onClick={onRetry}
        disabled={isRetrying}
        className="text-(--tl-danger)!"
      >
        <RotateCw
          aria-hidden
          className={cn("size-4", isRetrying && "animate-spin motion-reduce:animate-none")}
        />
        {isRetrying ? "Trying again…" : "Try again"}
      </TextLink>
    </div>
  );
}
