// Edit subjects: tick the live Subjects someone teaches, each with the
// highest grade they take. Save sends only the difference; a failure
// part-way shows a form alert and the ticks follow the refetched row.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import { refreshStaff } from "@/lib/queries/staff";
import type { StaffRead } from "@/lib/queries/staff";
import { subjectQueries } from "@/lib/queries/subjects";
import type { Subject } from "@/lib/queries/subjects";
import { assignSubject, removeSubject } from "@/lib/queries/tutorSubjects";
import {
  hasSubjectChanges,
  planSubjectChanges,
} from "@/pages/staff/lib/subject-changes";
import type {
  SubjectChanges,
  SubjectGrades,
} from "@/pages/staff/lib/subject-changes";

// A new tick starts here; most Subjects run to about this grade.
const DEFAULT_GRADE = 5;
const PARTLY_FAILED = "Some subjects didn’t save. Check them and try again.";

type SubjectsSheet = {
  // Undefined until the first load.
  subjects: Subject[] | undefined;
  hasFailed: boolean;
  isRetrying: boolean;
  retry: () => void;
  getGrade: (subjectId: string) => number | null;
  setGrade: (subjectId: string, grade: number | null) => void;
  toggle: (subjectId: string, isChecked: boolean) => void;
  isSaving: boolean;
  formError: string | null;
  save: () => void;
  close: () => void;
};

async function applySubjectChanges(
  tutorId: string,
  changes: SubjectChanges,
): Promise<void> {
  // One call at a time, each new grade finished before the next starts,
  // so a failure can drop at most the one Subject it was regrading.
  for (const regrade of changes.regrades) {
    await removeSubject(tutorId, regrade.subject_id);
    await assignSubject(tutorId, regrade);
  }
  for (const subjectId of changes.removeIds) {
    await removeSubject(tutorId, subjectId);
  }
  for (const add of changes.adds) {
    await assignSubject(tutorId, add);
  }
}

export function useSubjectsSheet(
  staff: StaffRead,
  isOpen: boolean,
  onClose: () => void,
): SubjectsSheet {
  const client = useQueryClient();
  const { showToast } = useToast();
  const query = useQuery({ ...subjectQueries.active(), enabled: isOpen });
  // Only the rows the user changed; the rest follow the saved row.
  const [overrides, setOverrides] = useState<SubjectGrades>({});
  const [formError, setFormError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (changes: SubjectChanges) =>
      applySubjectChanges(staff.tutor_id ?? "", changes),
    // A part-way failure changed the server too.
    onSettled: () => refreshStaff(client),
  });

  function getGrade(subjectId: string): number | null {
    const saved = staff.subjects.find((subject) => subject.id === subjectId);
    return subjectId in overrides
      ? overrides[subjectId]
      : (saved?.max_grade_level ?? null);
  }

  function setGrade(subjectId: string, grade: number | null): void {
    setOverrides((current) => ({ ...current, [subjectId]: grade }));
  }

  function close(): void {
    // Closing mid-save would hide whether it worked.
    if (mutation.isPending) return;
    setOverrides({});
    setFormError(null);
    onClose();
  }

  function save(): void {
    const wanted = Object.fromEntries(
      (query.data ?? []).map((subject) => [subject.id, getGrade(subject.id)]),
    );
    const changes = planSubjectChanges(staff.subjects, wanted);
    if (!hasSubjectChanges(changes)) {
      close();
      return;
    }
    setFormError(null);
    mutation.mutate(changes, {
      onSuccess: () => {
        setOverrides({});
        onClose();
        showToast({ tone: "success", message: "Subjects saved." });
      },
      onError: () => {
        setFormError(PARTLY_FAILED);
        setOverrides({});
      },
    });
  }

  return {
    subjects: query.data,
    hasFailed: !query.data && (query.isError || query.errorUpdateCount > 0),
    isRetrying: query.isFetching,
    retry: () => void query.refetch(),
    getGrade,
    setGrade,
    toggle: (subjectId, isChecked) =>
      setGrade(subjectId, isChecked ? DEFAULT_GRADE : null),
    isSaving: mutation.isPending,
    formError,
    save,
    close,
  };
}
