// Assigned Tutors, the data half (TutorLink#242). A named contract for
// Staff › Children; keep these exports:
//   assignedTutorQueries.assignable()  live Tutors and Managers, by name
//   saveAssignedTutors(childId, currentIds, wantedIds)
//   assignedTutorMutations.save()       mutationOptions around it
// The pure half (plan, coverage line, uncovered levels) is
// @/lib/families/assigned-tutors.
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { planAssignedTutors, selectAssignable } from "@/lib/families/assigned-tutors";
import type { AssignedTutorsPlan } from "@/lib/families/assigned-tutors";
import { refreshFamilies } from "@/lib/queries/families";
import type { Page, StaffRead } from "@/types/families";

// The API's page cap; the Office's Staff fit in one page.
const STAFF_PAGE_SIZE = 100;

export const assignedTutorQueries = {
  assignable: () =>
    queryOptions({
      queryKey: ["staff", "assignable"],
      queryFn: async (): Promise<StaffRead[]> => {
        const response = await api.get<Page<StaffRead>>("/api/staff", {
          params: { archived: false, page_size: STAFF_PAGE_SIZE },
        });
        return selectAssignable(response.data.items);
      },
    }),
};

// A save that failed part-way: `applied` already reached the server.
export class AssignedTutorsSaveError extends Error {
  readonly applied: AssignedTutorsPlan;

  constructor(applied: AssignedTutorsPlan, cause: unknown) {
    super("Couldn’t save every Assigned Tutor", { cause });
    this.name = "AssignedTutorsSaveError";
    this.applied = applied;
  }
}

// Adds go first, so a swap never leaves the Child with no Tutor (and in
// To do) half-way. Throws AssignedTutorsSaveError on the first failure.
export async function saveAssignedTutors(
  childId: string,
  currentIds: string[],
  wantedIds: string[],
): Promise<AssignedTutorsPlan> {
  const plan = planAssignedTutors(currentIds, wantedIds);
  const applied: AssignedTutorsPlan = { add: [], remove: [] };
  try {
    for (const userId of plan.add) {
      await api.post(`/api/children/${childId}/assigned-tutors`, {
        user_id: userId,
      });
      applied.add.push(userId);
    }
    for (const userId of plan.remove) {
      await api.delete(`/api/children/${childId}/assigned-tutors/${userId}`);
      applied.remove.push(userId);
    }
  } catch (error) {
    throw new AssignedTutorsSaveError(applied, error);
  }
  return applied;
}

export type AssignedTutorsSave = {
  childId: string;
  currentIds: string[];
  wantedIds: string[];
};

export const assignedTutorMutations = {
  save: () =>
    mutationOptions({
      mutationFn: ({ childId, currentIds, wantedIds }: AssignedTutorsSave) =>
        saveAssignedTutors(childId, currentIds, wantedIds),
      // A part-way failure changed the server too.
      onSettled: (_data, _error, _vars, _result, { client }) =>
        refreshFamilies(client, { hasCounts: true, hasStaff: true }),
    }),
};
