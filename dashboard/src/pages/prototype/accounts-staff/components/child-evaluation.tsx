// The Child's Subject levels (what Tutors are matched against) and the
// Mark Evaluated action. No Evaluated status pill anywhere (Franklin:
// every Child is evaluated eventually); the action stays because only an
// Evaluated Child can be booked through the bot.
import { useState } from "react";
import type { ReactNode } from "react";
import { BadgeCheck, Plus } from "lucide-react";
import { cn, EYEBROW } from "@/components/kit/tokens";
import { Button } from "@/components/kit/components/button";
import { useToast } from "@/components/kit/overlays/use-toast";
import { LevelSheet } from "@/pages/prototype/accounts-staff/components/child-sheets";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  formatGrade,
  formatLongDate,
} from "@/pages/prototype/accounts-staff/lib/labels";
import type { ChildDetail } from "@/pages/prototype/accounts-staff/types/api";

type ChildEvaluationProps = { child: ChildDetail; onMarkEvaluated: () => void };

// Mark Evaluated opens a sheet that also sets the first Assigned Tutors
// (TutorLink#242).
export default function ChildEvaluation({ child, onMarkEvaluated }: ChildEvaluationProps): ReactNode {
  const { setLevel } = useArea();
  const { showToast } = useToast();
  const [isLevelOpen, setIsLevelOpen] = useState(false);
  const isLocked = child.archived;

  return (
    <>
      <div className="mt-8 mb-3 flex items-center justify-between gap-3">
        <h3 className={EYEBROW}>Subject levels</h3>
        {!isLocked && (
          <Button variant="soft" icon={Plus} onClick={() => setIsLevelOpen(true)}>
            Set level
          </Button>
        )}
      </div>
      <div className="rounded-[18px] border border-(--tl-border) bg-(--tl-surface)">
        {child.levels.length === 0 ? (
          <p className="px-4 py-3 text-[14px] text-(--tl-muted)">
            No Subject levels yet. Set them after the Evaluation session.
          </p>
        ) : (
          <ul className="divide-y divide-(--tl-border)">
            {child.levels.map((item) => (
              <li key={item.subject_id} className={cn("flex items-center justify-between gap-3 px-4 py-3", item.archived && "text-(--tl-muted)")}>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold">
                    {item.name}
                    {item.archived && " (archived Subject)"}
                  </span>
                  <span className="block text-[13px] text-(--tl-muted)">Set by {item.set_by.name}</span>
                </span>
                <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">{formatGrade(item.level)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-(--tl-border) px-4 py-3">
          {child.evaluated ? (
            <p className="flex items-center gap-2 text-[14px]">
              <BadgeCheck aria-hidden className="size-4 text-(--tl-success)" />
              Evaluated {formatLongDate(child.evaluated.at)} by {child.evaluated.by.name}
            </p>
          ) : (
            <>
              <p className="text-[14px] text-(--tl-muted)">The bot can’t book them until they’re Evaluated.</p>
              {!isLocked && (
                <Button icon={BadgeCheck} onClick={onMarkEvaluated}>
                  Mark Evaluated
                </Button>
              )}
            </>
          )}
        </div>
      </div>
      {isLevelOpen && (
        <LevelSheet
          child={child}
          onClose={() => setIsLevelOpen(false)}
          onSave={(subjectId, level) => {
            setLevel(child.id, subjectId, level);
            setIsLevelOpen(false);
            showToast({ tone: "success", message: "Subject level saved." });
          }}
        />
      )}
    </>
  );
}
