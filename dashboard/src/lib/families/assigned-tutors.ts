// Assigned Tutors (TutorLink#242), the pure half. A named contract:
// Families and Staff › Children both use it, so keep these exports.
//   selectAssignable(staff)            who can be one, sorted by name
//   planAssignedTutors(current, wanted) the adds and removes a save makes
//   describeCoverage(tutor, levels)    the line under a Tutor's name
//   uncoveredLevels(levels, tutors)    levels none of the Tutors cover
// The bot offers only Assigned Tutors who cover the Subject level asked
// for; anything else goes to the office.
import { gradeName } from "@/lib/grades/grades";
import type { StaffRead } from "@/types/families";

export type AssignableStaff = Pick<StaffRead, "id" | "name" | "role" | "subjects">;

// A Child's Subject level: ChildLevelRead and ChildLevelRef both fit.
export type CoverageLevel = { subject_id: string; name: string; level: number };

export type AssignedTutorsPlan = { add: string[]; remove: string[] };

const ASSIGNABLE_ROLES: readonly StaffRead["role"][] = ["tutor", "manager"];

// Admins (and Developers) are never Assigned Tutors. The caller asks the
// API for live Staff only.
export function selectAssignable<T extends AssignableStaff>(staff: T[]): T[] {
  return staff
    .filter((person) => ASSIGNABLE_ROLES.includes(person.role))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function planAssignedTutors(
  currentIds: string[],
  wantedIds: string[],
): AssignedTutorsPlan {
  return {
    add: wantedIds.filter((id) => !currentIds.includes(id)),
    remove: currentIds.filter((id) => !wantedIds.includes(id)),
  };
}

function formatLevel(level: CoverageLevel): string {
  return `${level.name} ${gradeName(level.level)}`;
}

function covers(tutor: AssignableStaff, level: CoverageLevel): boolean {
  return tutor.subjects.some(
    (subject) =>
      subject.id === level.subject_id && subject.max_grade_level >= level.level,
  );
}

export function describeCoverage(
  tutor: AssignableStaff,
  levels: CoverageLevel[],
): string {
  if (tutor.subjects.length === 0) return "No Subjects yet";
  if (levels.length === 0) {
    return tutor.subjects
      .map((subject) => `${subject.name} to ${gradeName(subject.max_grade_level)}`)
      .join(" · ");
  }

  const covered = levels.filter((level) => covers(tutor, level));
  const missed = levels.filter((level) => !covers(tutor, level));
  let line = `Covers ${covered.map((level) => level.name).join(", ")} · not ${missed.map((level) => level.name).join(", ")}`;
  if (missed.length === 0) {
    line = `Covers ${covered.map(formatLevel).join(", ")}`;
  } else if (covered.length === 0) {
    line = `Doesn’t cover ${missed.map(formatLevel).join(", ")}`;
  }
  return line;
}

export function uncoveredLevels<T extends CoverageLevel>(
  levels: T[],
  tutors: AssignableStaff[],
): T[] {
  return levels.filter((level) => !tutors.some((tutor) => covers(tutor, level)));
}
