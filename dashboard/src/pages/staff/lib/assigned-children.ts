// Staff › Children, the pure half: which Children a Staff member is an
// Assigned Tutor of, the words on their rows, and what a save changes.
import { describeCoverage } from "@/lib/families/assigned-tutors";
import { joinNames } from "@/lib/families/guardian-archive";
import type {
  ChildTutorsChange,
  EvaluatedChild,
} from "@/lib/queries/assigned-children";
import type { StaffRead } from "@/lib/queries/staff";
import type { NamedRef } from "@/types/families";

// Spelled out up to this many surnames, as the API names a family.
const MAX_LISTED_SURNAMES = 2;

export function getFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function getSurname(name: string): string {
  return name.trim().split(/\s+/).at(-1) ?? name;
}

// "Garcia family", "Martinez & Reyes family", "Ana Gomez + 2 family":
// the API's naming rule, applied to this Child's own Guardians (archived
// ones included). The household name can differ when an archived or a
// sibling's Guardian changes it; ChildSummary doesn't carry that name.
export function getFamilyName(guardians: NamedRef[]): string {
  const surnames = new Map<string, string>();
  for (const guardian of guardians) {
    const surname = getSurname(guardian.name);
    if (!surnames.has(surname.toLowerCase())) {
      surnames.set(surname.toLowerCase(), surname);
    }
  }
  let label = [...surnames.values()].join(" & ");
  if (surnames.size > MAX_LISTED_SURNAMES) {
    label = `${guardians[0].name} + ${guardians.length - 1}`;
  }
  return `${label} family`;
}

export function isAssignedTo(child: EvaluatedChild, staffId: string): boolean {
  return child.assigned_tutors.some((tutor) => tutor.id === staffId);
}

// Assigned Tutors are always live, so the list is the live ones.
export function isOnlyTutor(child: EvaluatedChild, staffId: string): boolean {
  return child.assigned_tutors.length === 1 && isAssignedTo(child, staffId);
}

export function describeChild(child: EvaluatedChild, staff: StaffRead): string {
  return `${getFamilyName(child.guardians)} · ${describeCoverage(staff, child.levels)}`;
}

// The Children whose tick changed, each with its Tutors before and after.
export function planChildrenChanges(
  children: EvaluatedChild[],
  staffId: string,
  selectedIds: string[],
): ChildTutorsChange[] {
  return children
    .filter((child) => isAssignedTo(child, staffId) !== selectedIds.includes(child.id))
    .map((child) => {
      const currentIds = child.assigned_tutors.map((tutor) => tutor.id);
      const wantedIds = isAssignedTo(child, staffId)
        ? currentIds.filter((id) => id !== staffId)
        : [...currentIds, staffId];
      return { childId: child.id, currentIds, wantedIds };
    });
}

// "Saved. Emma now needs a Tutor and is in To do." for the Children a
// save leaves with no Assigned Tutor; null when there are none.
export function describeLeftWithoutTutor(
  children: EvaluatedChild[],
  changes: ChildTutorsChange[],
): string | null {
  const emptied = changes.filter((change) => change.wantedIds.length === 0);
  if (emptied.length === 0) return null;

  const names = emptied.map((change) =>
    getFirstName(children.find((child) => child.id === change.childId)?.name ?? ""),
  );
  const verb = emptied.length === 1 ? "needs a Tutor and is" : "need a Tutor and are";
  return `Saved. ${joinNames(names)} now ${verb} in To do.`;
}
