// Mark Evaluated and its Undo as single mutations: each runs several
// requests in a fixed order and refreshes Families once, when all of
// them settle (a part-way failure changed the server too).
//   markEvaluated: PUT new and changed levels, DELETE removed ones,
//                  then POST …/evaluated {tutor_ids}.
//   undoMarkEvaluated: DELETE …/evaluated (the Tutors stay), then the
//                  level plan back to the earlier levels.
// The plans come from planLevels (@/lib/families/level-plan).
import { mutationOptions } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { LevelPlan } from "@/lib/families/level-plan";
import { refreshFamilies } from "@/lib/queries/families";
import type { EvaluatedRead } from "@/types/families";

export type EvaluatedSave = { childId: string; levels: LevelPlan; tutorIds: string[] };

export type EvaluatedUndo = { childId: string; levels: LevelPlan };

// Undo cleared Evaluated but couldn't put every level back.
export class LevelsNotRestoredError extends Error {
  constructor(cause: unknown) {
    super("Cleared Evaluated but couldn’t restore every Subject level", { cause });
    this.name = "LevelsNotRestoredError";
  }
}

async function applyLevelPlan(childId: string, plan: LevelPlan): Promise<void> {
  for (const { subjectId, level } of plan.put) {
    await api.put(`/api/children/${childId}/levels/${subjectId}`, { level });
  }
  for (const subjectId of plan.remove) {
    await api.delete(`/api/children/${childId}/levels/${subjectId}`);
  }
}

export const childEvaluationMutations = {
  markEvaluated: () =>
    mutationOptions({
      mutationFn: async ({
        childId,
        levels,
        tutorIds,
      }: EvaluatedSave): Promise<EvaluatedRead> => {
        await applyLevelPlan(childId, levels);
        const response = await api.post<EvaluatedRead>(
          `/api/children/${childId}/evaluated`,
          { tutor_ids: tutorIds },
        );
        return response.data;
      },
      onSettled: (_data, _error, _vars, _result, { client }) =>
        refreshFamilies(client, { hasCounts: true, hasStaff: true }),
    }),

  undoMarkEvaluated: () =>
    mutationOptions({
      mutationFn: async ({ childId, levels }: EvaluatedUndo): Promise<void> => {
        await api.delete(`/api/children/${childId}/evaluated`);
        try {
          await applyLevelPlan(childId, levels);
        } catch (error) {
          throw new LevelsNotRestoredError(error);
        }
      },
      onSettled: (_data, _error, _vars, _result, { client }) =>
        refreshFamilies(client, { hasCounts: true }),
    }),
};
