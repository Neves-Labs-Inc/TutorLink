import { describe, expect, it } from "vitest";
import {
  describeCoverage,
  planAssignedTutors,
  selectAssignable,
  uncoveredLevels,
} from "@/lib/families/assigned-tutors";
import type {
  AssignableStaff,
  CoverageLevel,
} from "@/lib/families/assigned-tutors";

const MATH = "subject-math";
const READING = "subject-reading";
const SCIENCE = "subject-science";

const MATH_5: CoverageLevel = { subject_id: MATH, name: "Math", level: 5 };
const READING_4: CoverageLevel = {
  subject_id: READING,
  name: "Reading",
  level: 4,
};

function makeStaff(
  overrides: Partial<AssignableStaff> & Pick<AssignableStaff, "id">,
): AssignableStaff {
  return { name: "Ana Lima", role: "tutor", subjects: [], ...overrides };
}

const ANA = makeStaff({
  id: "ana",
  name: "Ana Lima",
  subjects: [
    { id: MATH, name: "Math", max_grade_level: 8 },
    { id: READING, name: "Reading", max_grade_level: 6 },
  ],
});
const MARCO = makeStaff({
  id: "marco",
  name: "Marco Reyes",
  subjects: [
    { id: MATH, name: "Math", max_grade_level: 5 },
    { id: READING, name: "Reading", max_grade_level: 3 },
  ],
});
const SOFIA = makeStaff({
  id: "sofia",
  name: "Sofia Cruz",
  subjects: [{ id: SCIENCE, name: "Science", max_grade_level: 12 }],
});

describe("planAssignedTutors", () => {
  it("adds the wanted ids that aren't assigned yet and removes the rest", () => {
    expect(planAssignedTutors(["a", "b"], ["b", "c", "d"])).toEqual({
      add: ["c", "d"],
      remove: ["a"],
    });
  });

  it("plans nothing when the picks match what is assigned", () => {
    expect(planAssignedTutors(["a", "b"], ["b", "a"])).toEqual({
      add: [],
      remove: [],
    });
  });

  it("removes every Tutor when none are wanted", () => {
    expect(planAssignedTutors(["a", "b"], [])).toEqual({
      add: [],
      remove: ["a", "b"],
    });
  });
});

describe("describeCoverage", () => {
  it("lists every level when the Tutor covers them all", () => {
    expect(describeCoverage(ANA, [MATH_5, READING_4])).toBe(
      "Covers Math Grade 5, Reading Grade 4",
    );
  });

  it("names covered and missed Subjects when the Tutor covers some", () => {
    expect(describeCoverage(MARCO, [MATH_5, READING_4])).toBe(
      "Covers Math · not Reading",
    );
  });

  it("lists the missed levels when the Tutor covers none", () => {
    expect(describeCoverage(SOFIA, [READING_4])).toBe(
      "Doesn’t cover Reading Grade 4",
    );
  });

  it("says the Tutor has no Subjects yet", () => {
    expect(describeCoverage(makeStaff({ id: "new" }), [MATH_5])).toBe(
      "No Subjects yet",
    );
  });

  it("lists the Tutor's Subjects when the Child has no levels", () => {
    expect(describeCoverage(ANA, [])).toBe("Math to Grade 8 · Reading to Grade 6");
  });

  it("reads grade 0 as Kindergarten", () => {
    const kindergartenMath = { ...MATH_5, level: 0 };
    expect(describeCoverage(SOFIA, [kindergartenMath])).toBe(
      "Doesn’t cover Math Kindergarten",
    );
  });
});

describe("uncoveredLevels", () => {
  it("keeps only the levels no picked Tutor covers", () => {
    const art = { subject_id: "subject-art", name: "Art", level: 2 };
    expect(uncoveredLevels([MATH_5, READING_4, art], [MARCO])).toEqual([
      READING_4,
      art,
    ]);
  });

  it("finds nothing uncovered when one Tutor covers what another misses", () => {
    expect(uncoveredLevels([MATH_5, READING_4], [MARCO, ANA])).toEqual([]);
  });

  it("finds every level uncovered with no Tutors", () => {
    expect(uncoveredLevels([MATH_5], [])).toEqual([MATH_5]);
  });
});

describe("selectAssignable", () => {
  it("keeps Tutors and Managers, sorted by name", () => {
    const admin = makeStaff({ id: "admin", name: "Aaron Admin", role: "admin" });
    const developer = makeStaff({
      id: "dev",
      name: "Dee Dev",
      role: "developer",
    });
    const manager = makeStaff({ id: "mgr", name: "Bea Boss", role: "manager" });
    const picked = selectAssignable([SOFIA, admin, MARCO, developer, manager]);
    expect(picked.map((staff) => staff.name)).toEqual([
      "Bea Boss",
      "Marco Reyes",
      "Sofia Cruz",
    ]);
  });
});
