// The family's Children, first on the overview: a card each with grade,
// school, Subject levels and next booking. No Evaluated pill. Cards open
// Child details.
import type { ReactNode } from "react";
import { CalendarDays, ChevronRight, Plus, UserRoundX, Users } from "lucide-react";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";
import { ArchivedBadge, Avatar, Badge } from "@/components/kit/components/badges";
import { needsTutor } from "@/pages/prototype/accounts-staff/lib/assigned-tutors";
import { Button } from "@/components/kit/components/button";
import OpenQuestion from "@/pages/prototype/accounts-staff/components/open-question";
import { DOT_CLASSES } from "@/pages/prototype/accounts-staff/lib/child-tones";
import type { ChildTone } from "@/pages/prototype/accounts-staff/lib/child-tones";
import {
  formatGrade,
  formatWeekdayDate,
  formatWireTime,
} from "@/pages/prototype/accounts-staff/lib/labels";
import type { ChildSummary } from "@/pages/prototype/accounts-staff/types/api";

const ADD_CHILD_QUESTION =
  "When the office adds a Child by hand to a family with several Guardians, which of them does the Child link to, and does it ask anything Intake-style?";

type FamilyChildrenProps = {
  items: ChildSummary[];
  // Each Child's colour in the week below.
  tones: Map<string, ChildTone>;
  canAdd: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
};

function getLevels(child: ChildSummary): string {
  return child.levels.length > 0
    ? child.levels.map((item) => `${item.name} ${formatGrade(item.level)}`).join(" · ")
    : "No Subject levels yet";
}

// Assigned Tutors on the card (TutorLink#242): their names, or a Needs a
// Tutor badge for an Evaluated Child with none. Nothing before Evaluated.
function ChildTutorsLine({ child }: { child: ChildSummary }): ReactNode {
  if (!child.evaluated || child.archived) return null;
  if (needsTutor(child)) {
    return (
      <span className="mt-2 block">
        <Badge tone="warning" icon={UserRoundX}>
          Needs a Tutor
        </Badge>
      </span>
    );
  }
  const names = child.assigned_tutors.map((tutor) => tutor.name);
  return (
    <span className="mt-2 flex items-start gap-2 text-[14px] text-(--tl-ink-soft)">
      <Users aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
      <span>
        <span className="sr-only">Assigned Tutors: </span>
        {names.join(", ")}
      </span>
    </span>
  );
}

export default function FamilyChildren({ items, tones, canAdd, onAdd, onOpen }: FamilyChildrenProps): ReactNode {
  return (
    <section aria-labelledby="family-children">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="family-children" className={EYEBROW}>
          Children · {items.filter((child) => !child.archived).length}
        </h2>
        {canAdd && (
          <span className="flex items-center">
            <OpenQuestion question={ADD_CHILD_QUESTION} />
            <Button variant="soft" icon={Plus} onClick={onAdd}>
              Add child
            </Button>
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <p className={cn(CARD, "px-5 py-6 text-[15px] text-(--tl-muted)")}>
          No Children yet. Add one, or they’re added when the Guardian answers Intake.
        </p>
      ) : (
        <ul className="grid gap-3 @3xl:grid-cols-2">
          {items.map((child) => {
            const next = child.next_session;
            return (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => onOpen(child.id)}
                  aria-label={`Open ${child.name}`}
                  className={cn(
                    CARD,
                    "flex h-full w-full cursor-pointer items-start gap-4 p-4 text-left transition-colors duration-150 hover:border-(--tl-hero) @2xl:p-5",
                    child.archived && "text-(--tl-muted)",
                  )}
                >
                  <Avatar name={child.name} size="lg" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      {items.length > 1 && (
                        <span aria-hidden className={cn("size-2.5 rounded-full", DOT_CLASSES[tones.get(child.id) ?? "primary"])} />
                      )}
                      <span className="kit-display text-[20px] leading-7 font-bold">{child.name}</span>
                      {child.archived && <ArchivedBadge />}
                    </span>
                    <span className="block text-[14px] text-(--tl-ink-soft)">
                      {child.grade_level === null ? "Grade not set" : formatGrade(child.grade_level)}
                      {child.school_name && ` · ${child.school_name}`}
                    </span>
                    <span className="mt-1 block text-[13px] text-(--tl-muted)">{getLevels(child)}</span>
                    <ChildTutorsLine child={child} />
                    <span className="mt-3 flex items-center gap-2 text-[14px] font-medium">
                      <CalendarDays aria-hidden className="size-4 shrink-0 text-(--tl-muted)" />
                      {next ? (
                        <span className="tabular-nums">
                          {formatWeekdayDate(next.scheduled_date)}, {formatWireTime(next.start_time)} · {next.tutor.name}
                        </span>
                      ) : (
                        <span className="text-(--tl-muted)">Nothing booked</span>
                      )}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="mt-1 size-5 shrink-0 text-(--tl-muted)" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
