// The Subject level writes Mark Evaluated makes, as a pure plan:
// PUT the new and changed levels, DELETE the ones set back to Not set.
// Run back from the saved levels (planLevels(wanted, before)) it is the
// Undo: re-PUT the changed and removed ones, DELETE the ones it added.

// Subject id → level (0 is Kindergarten); a missing Subject is Not set.
export type LevelMap = Record<string, number>;

export type LevelPut = { subjectId: string; level: number };

export type LevelPlan = { put: LevelPut[]; remove: string[] };

export function planLevels(from: LevelMap, to: LevelMap): LevelPlan {
  return {
    put: Object.entries(to)
      .filter(([subjectId, level]) => from[subjectId] !== level)
      .map(([subjectId, level]) => ({ subjectId, level })),
    remove: Object.keys(from).filter((subjectId) => !(subjectId in to)),
  };
}
