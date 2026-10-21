// The calls that turn someone's Subjects into the ticked ones. The API
// has no grade update (`routers/tutor_subjects.py` is POST and DELETE
// only), so a new grade is a remove then an add of that one Subject.
import type { StaffSubject } from "@/lib/queries/staff";
import type { TutorSubjectCreate } from "@/lib/queries/tutorSubjects";

// A Subject's highest grade, or null when it isn't ticked.
export type SubjectGrades = Record<string, number | null>;

export type SubjectChanges = {
  // Kept Subjects with a new grade: each is removed and re-added before the next.
  regrades: TutorSubjectCreate[];
  removeIds: string[];
  adds: TutorSubjectCreate[];
};

export function hasSubjectChanges(changes: SubjectChanges): boolean {
  return (
    changes.regrades.length + changes.removeIds.length + changes.adds.length > 0
  );
}

// Only the Subjects in `wanted` are touched; a retired one stays as it is.
export function planSubjectChanges(
  current: StaffSubject[],
  wanted: SubjectGrades,
): SubjectChanges {
  const grades = new Map(
    current.map((subject) => [subject.id, subject.max_grade_level]),
  );
  const changed = Object.entries(wanted).filter(
    ([id, grade]) => (grades.get(id) ?? null) !== grade,
  );
  const toCreate = (id: string, grade: number): TutorSubjectCreate => ({
    subject_id: id,
    max_grade_level: grade,
  });
  return {
    regrades: changed.flatMap(([id, grade]) =>
      grades.has(id) && grade !== null ? [toCreate(id, grade)] : [],
    ),
    removeIds: changed
      .filter(([id, grade]) => grades.has(id) && grade === null)
      .map(([id]) => id),
    adds: changed.flatMap(([id, grade]) =>
      !grades.has(id) && grade !== null ? [toCreate(id, grade)] : [],
    ),
  };
}
