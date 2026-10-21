// One Child on the family page: a whole-card button opening their
// details. The name and grade come from the household; the rest from
// the Child's own details, which may still be loading or have failed.
import type { ReactNode } from "react";
import { CalendarDays, ChevronRight, UserRoundX, Users } from "lucide-react";
import {
  ArchivedBadge,
  Avatar,
  Badge,
} from "@/components/kit/components/badges";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import { CARD, CARD_TITLE, cn } from "@/components/kit/tokens";
import type { FamilyChild } from "@/hooks/use-family";
import {
  getGradeLine,
  getLevelsLine,
  getNextLine,
} from "@/pages/families/lib/child-labels";
import {
  RECORD_CARD,
  RECORD_CARD_ARCHIVED,
  RECORD_CHEVRON,
} from "@/pages/families/lib/family-classes";
import { DOT_CLASSES } from "@/components/kit/lib/child-tones";
import type { ChildTone } from "@/components/kit/lib/child-tones";
import type { ChildDetail } from "@/types/families";

type ChildCardProps = {
  child: FamilyChild;
  // Null: no dot (a lone Child, or the fifth on).
  tone: ChildTone | null;
  isNew: boolean;
  onOpen: () => void;
};

function CardSkeleton(): ReactNode {
  return (
    <div
      role="status"
      aria-label="Loading Children"
      className={cn(CARD, "flex h-full min-h-[148px] gap-4 p-4")}
    >
      <Skeleton className="size-12 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton className="h-5 w-2/5 rounded-full" />
        <Skeleton className="h-4 w-3/5 rounded-full" />
        <Skeleton className="h-3 w-1/2 rounded-full" />
        <Skeleton className="mt-3 h-4 w-2/5 rounded-full" />
      </div>
    </div>
  );
}

type TutorsLineProps = { detail: ChildDetail };

// Only for an Evaluated Child: before that nothing is assigned.
function TutorsLine({ detail }: TutorsLineProps): ReactNode {
  if (!detail.evaluated) return null;
  if (detail.assigned_tutors.length === 0) {
    return (
      <span className="mt-2 block">
        <Badge tone="warning" icon={UserRoundX}>
          Needs a Tutor
        </Badge>
      </span>
    );
  }
  return (
    <span className="mt-2 flex items-start gap-2 text-[14px] leading-5 text-(--tl-ink-soft)">
      <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
      <span>
        <span className="sr-only">Assigned Tutors: </span>
        {detail.assigned_tutors.map((tutor) => tutor.name).join(", ")}
      </span>
    </span>
  );
}

export default function ChildCard({
  child,
  tone,
  isNew,
  onOpen,
}: ChildCardProps): ReactNode {
  const { detail } = child;
  // A retry puts the query back to pending; the failure stays up.
  const hasFailed = detail.isError || detail.errorUpdateCount > 0;

  if (!detail.data && hasFailed) {
    const [firstName] = child.name.split(" ");
    return (
      <div className={cn(CARD, "h-full p-4")}>
        <p className={cn(CARD_TITLE, "mb-2")}>{child.name}</p>
        <InlineError
          message={`Couldn’t load ${firstName}. Check your connection.`}
          onRetry={() => void detail.refetch()}
          isRetrying={detail.isFetching}
        />
      </div>
    );
  }
  if (!detail.data) return <CardSkeleton />;

  const data = detail.data;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${child.name}`}
      className={cn(
        RECORD_CARD,
        "h-full items-start gap-4",
        child.archived && RECORD_CARD_ARCHIVED,
        isNew && "kit-rise",
      )}
    >
      <Avatar name={child.name} size="lg" />
      <span className="block min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          {tone && tone !== "neutral" && (
            <span
              aria-hidden
              className={cn("size-2.5 rounded-full", DOT_CLASSES[tone])}
            />
          )}
          <span className={CARD_TITLE}>{child.name}</span>
          {child.archived && <ArchivedBadge />}
        </span>
        <span
          className={cn(
            "mt-1 block truncate text-[14px] leading-5",
            !child.archived && "text-(--tl-ink-soft)",
          )}
        >
          {getGradeLine(data.grade_level, data.school_name)}
        </span>
        <span className="block text-[13px] leading-[18px] text-(--tl-muted)">
          {getLevelsLine(data.levels)}
        </span>
        {!child.archived && <TutorsLine detail={data} />}
        <span className="mt-3 flex items-center gap-2 text-[14px] font-medium tabular-nums">
          <CalendarDays
            aria-hidden
            className="size-4 shrink-0 text-(--tl-muted)"
          />
          {getNextLine(data.next_session)}
        </span>
      </span>
      <ChevronRight aria-hidden className={cn(RECORD_CHEVRON, "mt-1")} />
    </button>
  );
}
