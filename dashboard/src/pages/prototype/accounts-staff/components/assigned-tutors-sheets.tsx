// The two forms that set a Child's Assigned Tutors (TutorLink#242):
//   Assigned Tutors   change them any time after Mark Evaluated. Saving
//                     with none is allowed, after a confirm: the Child
//                     then waits in To do › Bookings.
//   Mark Evaluated    Subject levels and at least one Assigned Tutor in
//                     one step, the Tutor prefilled with whoever ran the
//                     Evaluation session, unless that was an Admin.
import { useState } from "react";
import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { EYEBROW } from "@/components/kit/tokens";
import { Button } from "@/components/kit/components/button";
import { SelectField } from "@/components/kit/components/fields";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { useToast } from "@/components/kit/overlays/use-toast";
import AssignedTutorsPicker from "@/pages/prototype/accounts-staff/components/assigned-tutors-picker";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { canBeAssigned } from "@/pages/prototype/accounts-staff/lib/assigned-tutors";
import type { LevelLike } from "@/pages/prototype/accounts-staff/lib/assigned-tutors";
import { formatGrade, GRADE_OPTIONS } from "@/pages/prototype/accounts-staff/lib/labels";
import { SUBJECTS } from "@/pages/prototype/accounts-staff/lib/mock-data";
import type { ChildDetail } from "@/pages/prototype/accounts-staff/types/api";

function getFirstName(name: string): string {
  return name.split(" ")[0];
}

type AssignedTutorsSheetProps = { child: ChildDetail; onClose: () => void };

export function AssignedTutorsSheet({ child, onClose }: AssignedTutorsSheetProps): ReactNode {
  const { db, setAssignedTutors } = useArea();
  const { showToast } = useToast();
  const [selected, setSelected] = useState(() => child.assigned_tutors.map((tutor) => tutor.id));
  const [isConfirmingNone, setIsConfirmingNone] = useState(false);
  const levels = child.levels.filter((item) => !item.archived);
  const liveSelected = db.staff.filter((row) => selected.includes(row.id) && canBeAssigned(row));
  const hadLive = child.assigned_tutors.length > 0;
  const name = getFirstName(child.name);

  function save(): void {
    setAssignedTutors(child.id, selected);
    onClose();
    showToast({
      tone: "success",
      message:
        liveSelected.length === 0
          ? `${name} has no Assigned Tutors now, so they’re in To do until you assign one.`
          : "Assigned Tutors saved.",
    });
  }

  return (
    <>
      <BottomSheet
        isOpen
        onClose={onClose}
        title="Assigned Tutors"
        description={`Who the bot may book ${name} with. Pick Tutors who cover their Subject levels.`}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => (liveSelected.length === 0 && hadLive ? setIsConfirmingNone(true) : save())}
            >
              Save
            </Button>
          </>
        }
      >
        <AssignedTutorsPicker levels={levels} selected={selected} onChange={setSelected} />
      </BottomSheet>
      <ConfirmDialog
        isOpen={isConfirmingNone}
        onClose={() => setIsConfirmingNone(false)}
        onConfirm={() => {
          setIsConfirmingNone(false);
          save();
        }}
        title={`Leave ${name} with no Assigned Tutors?`}
        confirmLabel="Remove them all"
        keepLabel="Keep"
        isDestructive
      >
        The bot can’t book {name} and hands every request to the office.
        They show in To do › Bookings until someone is assigned. Booked
        sessions stay as they are.
      </ConfirmDialog>
    </>
  );
}

type MarkEvaluatedSheetProps = { child: ChildDetail; onClose: () => void };

const NOT_SET = "";

function getRunnerNote(child: ChildDetail, isPrefilled: boolean): string {
  const runner = child.evaluation_run_by;
  if (!runner) return "No Evaluation session on record. Pick who’ll teach them.";
  if (isPrefilled) return `${runner.name} ran the Evaluation session, so they’re picked to start.`;
  if (runner.role === "admin") {
    return `${runner.name} ran the Evaluation session, but Admins can’t be Assigned Tutors. Pick who’ll teach them.`;
  }
  return `${runner.name} ran the Evaluation session but can’t be assigned (archived). Pick who’ll teach them.`;
}

export function MarkEvaluatedSheet({ child, onClose }: MarkEvaluatedSheetProps): ReactNode {
  const { db, markEvaluated, updateChild } = useArea();
  const { showToast } = useToast();
  const runner = child.evaluation_run_by;
  const runnerRow = runner ? db.staff.find((row) => row.id === runner.id) : undefined;
  const isPrefilled = runnerRow !== undefined && canBeAssigned(runnerRow);
  const [grades, setGrades] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      SUBJECTS.map((subject) => {
        const existing = child.levels.find((item) => item.subject_id === subject.id && !item.archived);
        return [subject.id, existing ? String(existing.level) : NOT_SET];
      }),
    ),
  );
  const [selected, setSelected] = useState<string[]>(() => (isPrefilled && runner ? [runner.id] : []));
  const [showsErrors, setShowsErrors] = useState(false);
  const name = getFirstName(child.name);

  const levels: LevelLike[] = SUBJECTS.flatMap((subject) =>
    grades[subject.id] === NOT_SET
      ? []
      : [{ subject_id: subject.id, name: subject.name, level: Number(grades[subject.id]) }],
  );
  const liveSelected = db.staff.filter((row) => selected.includes(row.id) && canBeAssigned(row));
  const levelError = levels.length === 0 ? "Set at least one Subject level." : undefined;
  const tutorError = liveSelected.length === 0 ? "Pick at least one Tutor." : undefined;

  function handleSubmit(): void {
    if (levelError || tutorError) {
      setShowsErrors(true);
      return;
    }
    const before = markEvaluated(child.id, {
      levels: levels.map(({ subject_id, level }) => ({ subject_id, level })),
      staff_ids: liveSelected.map((row) => row.id),
    });
    onClose();
    showToast({
      tone: "success",
      message: `${child.name} marked Evaluated. The bot can book them with ${liveSelected.map((row) => getFirstName(row.name)).join(" or ")} now.`,
      actionLabel: "Undo",
      // Undo clears Evaluated and restores the levels but keeps the
      // Tutors it set, like clearing Evaluated (Franklin, 2026-10-15).
      onAction: () => {
        if (before) updateChild(child.id, { evaluated: before.evaluated, levels: before.levels });
      },
    });
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title="Mark Evaluated"
      description={`What the Evaluation session found, and who teaches ${name}. Only an Evaluated Child can be booked through the bot.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={BadgeCheck} onClick={handleSubmit}>
            Mark Evaluated
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <section aria-labelledby="mark-levels" className="flex flex-col gap-3">
          <h3 id="mark-levels" className={EYEBROW}>
            Subject levels
          </h3>
          <div className="grid gap-4 @md:grid-cols-2">
            {SUBJECTS.map((subject) => (
              <SelectField
                key={subject.id}
                label={subject.name}
                options={[{ value: NOT_SET, label: "Not set" }, ...GRADE_OPTIONS]}
                value={grades[subject.id]}
                onChange={(event) => setGrades((current) => ({ ...current, [subject.id]: event.target.value }))}
              />
            ))}
          </div>
          {showsErrors && levelError ? (
            <p className="px-1 text-[13px] font-medium text-(--tl-danger)">{levelError}</p>
          ) : (
            <p className="px-1 text-[13px] text-(--tl-muted)">
              The grade {name} works at in each Subject{child.grade_level !== null && ` (overall: ${formatGrade(child.grade_level)})`}. Leave the rest Not set.
            </p>
          )}
        </section>
        <section aria-labelledby="mark-tutors" className="flex flex-col gap-2">
          <h3 id="mark-tutors" className={EYEBROW}>
            Assigned Tutors
          </h3>
          <p className="text-[14px] leading-5 text-(--tl-ink-soft)">{getRunnerNote(child, isPrefilled)}</p>
          <AssignedTutorsPicker
            levels={levels}
            selected={selected}
            onChange={setSelected}
            error={showsErrors ? tutorError : undefined}
          />
        </section>
      </div>
    </BottomSheet>
  );
}
