// Mark Evaluated's form: a level per active Subject and the first
// Assigned Tutors, saved in one go (childEvaluationMutations). Success
// toasts with an Undo that clears Evaluated and puts the levels back as
// they were when the sheet opened; the Tutors stay. Mount a fresh
// instance per open (key).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { errorDetail, errorStatus } from "@/lib/api";
import type { CoverageLevel } from "@/lib/families/assigned-tutors";
import { getFirstName } from "@/lib/families/child-labels";
import { planLevels } from "@/lib/families/level-plan";
import type { LevelMap } from "@/lib/families/level-plan";
import { assignedTutorQueries } from "@/lib/queries/assigned-tutors";
import {
  childEvaluationMutations,
  LevelsNotRestoredError,
} from "@/lib/queries/child-evaluation";
import { familyQueries } from "@/lib/queries/families";
import type { ChildDetail, NamedRef, SubjectRead } from "@/types/families";

const CONFLICT = 409;
const UNPROCESSABLE = 422;
// child_evaluation.py's NO_LEVELS_ERROR.
const NO_LEVELS_DETAIL = /at least one subject level/i;

const LEVELS_REQUIRED = "Set at least one Subject level.";
const TUTORS_REQUIRED = "Pick at least one Tutor.";
// Select values are text; "" is Not set.
const NOT_SET = "";

export type MarkEvaluated = {
  subjects: UseQueryResult<SubjectRead[]>;
  getGrade: (subjectId: string) => string;
  setGrade: (subjectId: string, value: string) => void;
  levels: CoverageLevel[];
  selected: string[];
  setSelected: (ids: string[]) => void;
  runnerNote: string;
  levelError?: string;
  tutorError?: string;
  failure: string | null;
  isSaving: boolean;
  save: () => Promise<void>;
};

// The Child's levels on active Subjects (the ones the sheet shows).
function getLevelMap(child: ChildDetail): LevelMap {
  return Object.fromEntries(
    child.levels
      .filter((level) => !level.archived)
      .map((level) => [level.subject_id, level.level]),
  );
}

function onlySubjects(levels: LevelMap, subjects: SubjectRead[]): LevelMap {
  return Object.fromEntries(
    Object.entries(levels).filter(([subjectId]) =>
      subjects.some((subject) => subject.id === subjectId),
    ),
  );
}

// The API names no Admin runner (`evaluation_run_by` is null then), so
// anyone who can't be picked gets the generic line.
function getRunnerNote(child: ChildDetail): string {
  const runner = child.evaluation_run_by;
  return runner
    ? `${runner.name} ran the Evaluation session, so they’re picked to start.`
    : "No Evaluation session on record. Pick who’ll teach them.";
}

function getFirstNames(ids: string[], people: NamedRef[]): string {
  return ids
    .flatMap((id) => people.find((person) => person.id === id) ?? [])
    .map((person) => getFirstName(person.name))
    .join(" or ");
}

export function useMarkEvaluated(
  child: ChildDetail,
  onSaved: () => void,
): MarkEvaluated {
  const { showToast } = useToast();
  const subjects = useQuery(familyQueries.activeSubjects());
  const assignable = useQuery(assignedTutorQueries.assignable());
  const saveMutation = useMutation(childEvaluationMutations.markEvaluated());
  const undoMutation = useMutation(childEvaluationMutations.undoMarkEvaluated());
  const [grades, setGrades] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>(() =>
    child.evaluation_run_by ? [child.evaluation_run_by.id] : [],
  );
  // What Undo puts back: the levels as the sheet opened, before any
  // part-way save.
  const [earlier] = useState(() => getLevelMap(child));
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isLevelRefused, setIsLevelRefused] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const first = getFirstName(child.name);

  const current = getLevelMap(child);
  const getGrade = (subjectId: string): string =>
    grades[subjectId] ??
    (subjectId in current ? String(current[subjectId]) : NOT_SET);
  const shown = subjects.data ?? [];
  const chosen = shown.filter((subject) => getGrade(subject.id) !== NOT_SET);
  const wanted: LevelMap = Object.fromEntries(
    chosen.map((subject) => [subject.id, Number(getGrade(subject.id))]),
  );
  const levels: CoverageLevel[] = chosen.map((subject) => ({
    subject_id: subject.id,
    name: subject.name,
    level: wanted[subject.id],
  }));
  // Someone archived since the list loaded can't be sent.
  const pickedIds = assignable.data
    ? selected.filter((id) => assignable.data.some((person) => person.id === id))
    : selected;
  const hasNoLevels = hasSubmitted && chosen.length === 0;
  const hasNoTutors = hasSubmitted && pickedIds.length === 0;

  async function describeFailure(error: unknown, staffBefore: NamedRef[]): Promise<string> {
    let message = `Couldn’t mark ${first} Evaluated. Check your connection and try again.`;
    if (errorStatus(error) === UNPROCESSABLE) {
      // The API doesn't say who; whoever left the live list is.
      const fresh = (await assignable.refetch()).data ?? [];
      const gone = staffBefore.find(
        (person) =>
          pickedIds.includes(person.id) && !fresh.some((row) => row.id === person.id),
      );
      if (gone) message = `${gone.name} can’t be assigned any more. Pick someone else.`;
    }
    return message;
  }

  function undo(saved: LevelMap): void {
    const levelsBack = planLevels(saved, onlySubjects(earlier, shown));
    undoMutation.mutateAsync({ childId: child.id, levels: levelsBack }).catch((error) => {
      const message =
        error instanceof LevelsNotRestoredError
          ? `${first} isn’t Evaluated any more, but some Subject levels weren’t put back. Check them.`
          : `Couldn’t undo. ${first} is still Evaluated.`;
      showToast({ tone: "error", message });
    });
  }

  async function save(): Promise<void> {
    setHasSubmitted(true);
    setIsLevelRefused(false);
    setFailure(null);
    if (chosen.length === 0 || pickedIds.length === 0) return;

    const runner = child.evaluation_run_by;
    const staffBefore: NamedRef[] = [...(assignable.data ?? []), ...(runner ? [runner] : [])];
    try {
      await saveMutation.mutateAsync({
        childId: child.id,
        levels: planLevels(onlySubjects(current, shown), wanted),
        tutorIds: pickedIds,
      });
    } catch (error) {
      const isNoLevels =
        errorStatus(error) === CONFLICT && NO_LEVELS_DETAIL.test(errorDetail(error) ?? "");
      if (isNoLevels) {
        setIsLevelRefused(true);
      } else {
        setFailure(await describeFailure(error, staffBefore));
      }
      return;
    }
    onSaved();
    showToast({
      tone: "success",
      message: `${child.name} marked Evaluated. The bot can book them with ${getFirstNames(pickedIds, staffBefore)} now.`,
      actionLabel: "Undo",
      onAction: () => undo(wanted),
    });
  }

  return {
    subjects,
    getGrade,
    setGrade: (subjectId, value) =>
      setGrades((currentGrades) => ({ ...currentGrades, [subjectId]: value })),
    levels,
    selected,
    setSelected,
    runnerNote: getRunnerNote(child),
    levelError: hasNoLevels || isLevelRefused ? LEVELS_REQUIRED : undefined,
    // A failure line naming who can't be assigned says it already.
    tutorError: hasNoTutors && failure === null ? TUTORS_REQUIRED : undefined,
    failure,
    isSaving: saveMutation.isPending,
    save,
  };
}
