// Assigned Tutors from the Staff side (TutorLink#242): every Evaluated
// Child with its Assigned Tutors, for Staff › Children and its Change
// sheet. Writes go through the Families module's per-Child save.
import { queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CoverageLevel } from "@/lib/families/assigned-tutors";
import { saveAssignedTutors } from "@/lib/queries/assigned-tutors";
import type { AssignedTutorRead, NamedRef, Page } from "@/types/families";

// The fields of `ChildSummary` (api/app/schemas/child.py) these screens read.
export type EvaluatedChild = {
  id: string;
  name: string;
  archived: boolean;
  guardians: NamedRef[];
  levels: CoverageLevel[];
  assigned_tutors: AssignedTutorRead[];
};

// One Child's Assigned Tutors before and after a save.
export type ChildTutorsChange = {
  childId: string;
  currentIds: string[];
  wantedIds: string[];
};

// The API's page cap.
const CHILDREN_PAGE_SIZE = 100;

async function fetchEvaluated(archived: boolean): Promise<EvaluatedChild[]> {
  const children: EvaluatedChild[] = [];
  let hasMore = true;
  for (let page = 1; hasMore; page += 1) {
    const response = await api.get<Page<EvaluatedChild>>("/api/children", {
      params: {
        evaluated: true,
        archived,
        page,
        page_size: CHILDREN_PAGE_SIZE,
      },
    });
    const { items, total } = response.data;
    children.push(...items);
    hasMore = items.length > 0 && children.length < total;
  }
  return children;
}

export const assignedChildrenQueries = {
  // Live and archived, by name. Under "children" so every Child write
  // marks it stale.
  evaluated: () =>
    queryOptions({
      queryKey: ["children", "evaluated"],
      queryFn: async (): Promise<EvaluatedChild[]> => {
        const [live, archived] = await Promise.all([
          fetchEvaluated(false),
          fetchEvaluated(true),
        ]);
        return [...live, ...archived].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      },
    }),
};

// Each Child's save is its own requests, so they run side by side.
// Rejects when any Child failed (some may have saved).
export async function saveChildTutorsChanges(
  changes: ChildTutorsChange[],
): Promise<void> {
  const results = await Promise.allSettled(
    changes.map((change) =>
      saveAssignedTutors(change.childId, change.currentIds, change.wantedIds),
    ),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}

// Children, Staff (assigned_children) and To do's counts.
export async function refreshAssignedChildren(
  client: QueryClient,
): Promise<void> {
  await Promise.all(
    [["children"], ["staff"], ["counts"]].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}
