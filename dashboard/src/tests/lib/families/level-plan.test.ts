import { describe, expect, it } from "vitest";
import { planLevels } from "@/lib/families/level-plan";

const MATH = "subject-math";
const READING = "subject-reading";
const SCIENCE = "subject-science";

describe("planLevels", () => {
  it("puts new and changed levels and removes ones set back to Not set", () => {
    const before = { [MATH]: 4, [READING]: 3 };
    const wanted = { [MATH]: 5, [SCIENCE]: 2 };

    expect(planLevels(before, wanted)).toEqual({
      put: [
        { subjectId: MATH, level: 5 },
        { subjectId: SCIENCE, level: 2 },
      ],
      remove: [READING],
    });
  });

  it("leaves unchanged levels alone", () => {
    const levels = { [MATH]: 4, [READING]: 0 };

    expect(planLevels(levels, { ...levels })).toEqual({ put: [], remove: [] });
  });

  it("undoes a save when run back from the saved levels", () => {
    const before = { [MATH]: 4, [READING]: 3 };
    const wanted = { [MATH]: 5, [SCIENCE]: 2 };

    // Re-PUT the changed and removed ones, DELETE the one it added.
    expect(planLevels(wanted, before)).toEqual({
      put: [
        { subjectId: MATH, level: 4 },
        { subjectId: READING, level: 3 },
      ],
      remove: [SCIENCE],
    });
  });

  it("treats Kindergarten as a level, not Not set", () => {
    expect(planLevels({}, { [MATH]: 0 })).toEqual({
      put: [{ subjectId: MATH, level: 0 }],
      remove: [],
    });
  });
});
