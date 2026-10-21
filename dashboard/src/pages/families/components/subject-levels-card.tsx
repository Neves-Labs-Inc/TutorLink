// Child details' Subject levels: what Tutors are matched against, with
// the Evaluated line or the Mark Evaluated prompt in the card's footer.
// No Evaluated pill: every Child is Evaluated eventually, and only the
// bot cares.
import { useId } from "react";
import type { ReactNode } from "react";
import { BadgeCheck, Plus } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { formatDay, getDayKey } from "@/components/kit/format";
import { cn, EYEBROW } from "@/components/kit/tokens";
import { gradeName } from "@/lib/grades/grades";
import { BORDERED_LIST, LIST_ROW } from "@/pages/families/lib/evaluation-classes";
import { SECTION_HEAD } from "@/pages/families/lib/family-classes";
import type { ChildDetail, EvaluatedRead } from "@/types/families";

type SubjectLevelsCardProps = {
  child: ChildDetail;
  onSetLevel: () => void;
  onMarkEvaluated: () => void;
};

export default function SubjectLevelsCard({
  child,
  onSetLevel,
  onMarkEvaluated,
}: SubjectLevelsCardProps): ReactNode {
  const headingId = useId();
  const isLive = !child.archived;
  return (
    <section aria-labelledby={headingId} className="mt-8">
      <div className={SECTION_HEAD}>
        <h3 id={headingId} className={EYEBROW}>
          Subject levels
        </h3>
        {isLive && (
          <Button variant="soft" icon={Plus} onClick={onSetLevel}>
            Set level
          </Button>
        )}
      </div>
      <div className={BORDERED_LIST}>
        {child.levels.length === 0 ? (
          <p className="px-4 py-3 text-[14px] text-(--tl-muted)">
            No Subject levels yet
          </p>
        ) : (
          <ul className="divide-y divide-(--tl-border)">
            {child.levels.map((level) => (
              <li
                key={level.subject_id}
                className={cn(LIST_ROW, level.archived && "text-(--tl-muted)")}
              >
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">
                    {level.archived ? `${level.name} (archived Subject)` : level.name}
                  </span>
                  <span className="block text-[13px] text-(--tl-muted)">
                    Set by {level.set_by.name}
                  </span>
                </span>
                <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">
                  {gradeName(level.level)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--tl-border) px-4 py-3">
          {child.evaluated ? (
            <EvaluatedLine evaluated={child.evaluated} />
          ) : (
            <>
              <p className="text-[14px] text-(--tl-muted)">
                The bot can’t book them until they’re Evaluated.
              </p>
              {isLive && (
                <Button icon={BadgeCheck} onClick={onMarkEvaluated}>
                  Mark Evaluated
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

type EvaluatedLineProps = { evaluated: EvaluatedRead };

function EvaluatedLine({ evaluated }: EvaluatedLineProps): ReactNode {
  const day = formatDay(getDayKey(evaluated.at), {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return (
    <p className="flex items-center gap-2 text-[14px]">
      <BadgeCheck aria-hidden className="size-4 shrink-0 text-(--tl-success)" />
      Evaluated {day} by {evaluated.by.name}
    </p>
  );
}
