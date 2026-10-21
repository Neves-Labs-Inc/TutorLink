// Set Subject level's form: one active Subject and its level, saved with
// PUT …/levels/{subject_id}. The level starts at the Subject's current
// one, else the Overall grade. Mount a fresh instance per open (key).
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { gradeName, LOWEST_GRADE } from "@/lib/grades/grades";
import { familyMutations, familyQueries } from "@/lib/queries/families";
import type { ChildDetail, SubjectRead } from "@/types/families";

const SAVE_FAILED = "Couldn’t save the level. Check your connection and try again.";

export type SetLevel = {
  subjects: UseQueryResult<SubjectRead[]>;
  subjectId: string;
  level: string;
  // "Now Grade 5, set by Ana." when the Subject has a level.
  help?: string;
  failure: string | null;
  isSaving: boolean;
  setSubject: (subjectId: string) => void;
  setLevel: (level: string) => void;
  save: () => Promise<void>;
};

export function useSetLevel(child: ChildDetail, onSaved: () => void): SetLevel {
  const { showToast } = useToast();
  const subjects = useQuery(familyQueries.activeSubjects());
  const saveMutation = useMutation(familyMutations.setLevel());
  const [pickedSubject, setPickedSubject] = useState<string | null>(null);
  // Null: the Subject's prefill. Picking another Subject resets it.
  const [pickedLevel, setPickedLevel] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const subjectId = pickedSubject ?? subjects.data?.[0]?.id ?? "";
  const current = child.levels.find((level) => level.subject_id === subjectId);
  const prefill = current?.level ?? child.grade_level ?? LOWEST_GRADE;
  const level = pickedLevel ?? String(prefill);

  async function save(): Promise<void> {
    if (subjectId === "") return;

    setFailure(null);
    try {
      await saveMutation.mutateAsync({
        childId: child.id,
        subjectId,
        level: Number(level),
      });
    } catch {
      setFailure(SAVE_FAILED);
      return;
    }
    onSaved();
    showToast({ tone: "success", message: "Subject level saved." });
  }

  return {
    subjects,
    subjectId,
    level,
    help: current
      ? `Now ${gradeName(current.level)}, set by ${current.set_by.name}.`
      : undefined,
    failure,
    isSaving: saveMutation.isPending,
    setSubject: (next) => {
      setPickedSubject(next);
      setPickedLevel(null);
    },
    setLevel: setPickedLevel,
    save,
  };
}
