import { describe, expect, it } from "vitest";
import { locationLabel, roleLabel, staffLabel, subjectLabel } from "./bookingPresentation";

describe("subjectLabel", () => {
  it("names the subject of a Regular booking", () => {
    expect(subjectLabel({ kind: "regular", subject: { id: "s1", name: "Maths" } })).toEqual({
      kind: "subject",
      name: "Maths",
    });
  });

  it("marks an Evaluation, whose subject is null", () => {
    expect(subjectLabel({ kind: "evaluation", subject: null })).toEqual({ kind: "evaluation" });
  });
});

describe("locationLabel", () => {
  it("says In office for an in_office booking", () => {
    expect(locationLabel({ location: "in_office", home: null })).toBe("In office");
  });

  it("uses the home label when the home is loaded", () => {
    expect(
      locationLabel({ location: "home", home: { label: "Mum's", address: "1 High St" } }),
    ).toBe("Mum's");
  });

  it("falls back to the address when the home label is null", () => {
    expect(locationLabel({ location: "home", home: { label: null, address: "1 High St" } })).toBe(
      "1 High St",
    );
  });

  it("says Home when no home object is given, as on a list row", () => {
    expect(locationLabel({ location: "home" })).toBe("Home");
  });
});

describe("staffLabel and roleLabel", () => {
  it.each([
    ["tutor", "Tutor"],
    ["manager", "Manager"],
    ["admin", "Admin"],
  ] as const)("labels the %s role %s", (role, label) => {
    expect(roleLabel(role)).toBe(label);
    expect(staffLabel({ id: "u1", name: "Marta Lima", role })).toBe("Marta Lima");
    expect(staffLabel({ id: "u1", name: "Marta Lima", role }, true)).toBe(`Marta Lima · ${label}`);
  });
});
