// Assigned Tutors (TutorLink#242): who can be one (Tutors and Managers,
// never Admins), what each covers of a Child's Subject levels, and when
// a Child needs a Tutor. The bot offers only Assigned Tutors who cover
// the Subject level asked for; anything else is an Office handoff.
import type { Database, StaffRow } from "@/pages/prototype/accounts-staff/lib/mock-data";
import { formatGrade } from "@/pages/prototype/accounts-staff/lib/labels";
import type {
  AssignedTutorRef,
  EvaluatedRead,
  UserRole,
} from "@/pages/prototype/accounts-staff/types/api";

export type LevelLike = { subject_id: string; name: string; level: number };

export function canBeAssigned(staff: { role: UserRole; archived: boolean }): boolean {
  return !staff.archived && (staff.role === "tutor" || staff.role === "manager");
}

export function listAssignable(db: Database): StaffRow[] {
  return db.staff
    .filter(canBeAssigned)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatLevel(level: LevelLike): string {
  return `${level.name} ${formatGrade(level.level)}`;
}

export function covers(staff: StaffRow, level: LevelLike): boolean {
  return staff.subjects.some(
    (subject) =>
      subject.subject_id === level.subject_id && subject.max_grade_level >= level.level,
  );
}

// One line under a Tutor's name: what they cover of this Child.
export function describeCoverage(staff: StaffRow, levels: LevelLike[]): string {
  if (staff.subjects.length === 0) return "No Subjects yet";
  if (levels.length === 0) {
    return staff.subjects
      .map((subject) => `${subject.name} to ${formatGrade(subject.max_grade_level)}`)
      .join(" · ");
  }
  const covered = levels.filter((level) => covers(staff, level));
  const missed = levels.filter((level) => !covers(staff, level));
  if (missed.length === 0) return `Covers ${covered.map(formatLevel).join(", ")}`;
  if (covered.length === 0) return `Doesn’t cover ${missed.map(formatLevel).join(", ")}`;
  return `Covers ${covered.map((level) => level.name).join(", ")} · not ${missed.map((level) => level.name).join(", ")}`;
}

// The Subject levels none of these Tutors cover: requests for them go
// to the office.
export function getUncovered(levels: LevelLike[], tutors: StaffRow[]): LevelLike[] {
  return levels.filter((level) => !tutors.some((staff) => covers(staff, level)));
}

// Evaluated with none left: the last was removed, archived or made an
// Admin (both of which remove the link).
export function needsTutor(child: {
  archived: boolean;
  evaluated: EvaluatedRead | null;
  assigned_tutors: AssignedTutorRef[];
}): boolean {
  return !child.archived && child.evaluated !== null && child.assigned_tutors.length === 0;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
