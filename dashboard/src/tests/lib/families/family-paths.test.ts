import { describe, expect, it } from "vitest";
import {
  FAMILIES_PATH,
  familyChildPath,
  familyGuardianPath,
  familyPath,
  getLegacyRedirect,
  readDetailEntry,
  withDetailEntry,
} from "@/lib/families/family-paths";

describe("family paths", () => {
  it("puts the list at /families", () => {
    expect(FAMILIES_PATH).toBe("/families");
  });

  it("addresses a family by any member's id", () => {
    expect(familyPath("g-1")).toBe("/families/g-1");
  });

  it("deep-links a Child's details on their family", () => {
    expect(familyChildPath("g-1", "c-2")).toBe("/families/g-1?child=c-2");
  });

  it("deep-links a Guardian's details on their family", () => {
    expect(familyGuardianPath("c-2", "g-1")).toBe(
      "/families/c-2?guardian=g-1",
    );
  });

  it("encodes ids that aren't URL-safe", () => {
    expect(familyChildPath("a b", "c&d")).toBe("/families/a%20b?child=c%26d");
  });
});

describe("getLegacyRedirect", () => {
  it.each([
    ["/children", "/families"],
    ["/guardians", "/families"],
    ["/children/c-2", "/families/c-2?child=c-2"],
    ["/guardians/g-1", "/families/g-1?guardian=g-1"],
  ])("sends %s to %s", (from, to) => {
    const [, kind, id] = from.split("/");
    expect(getLegacyRedirect(kind === "children" ? "child" : "guardian", id)).toBe(to);
  });
});

describe("readDetailEntry", () => {
  it("reads a Child from ?child=", () => {
    expect(readDetailEntry(new URLSearchParams("child=c-2"))).toEqual({
      kind: "child",
      id: "c-2",
    });
  });

  it("reads a Guardian from ?guardian=", () => {
    expect(readDetailEntry(new URLSearchParams("guardian=g-1"))).toEqual({
      kind: "guardian",
      id: "g-1",
    });
  });

  it("reads nothing without either", () => {
    expect(readDetailEntry(new URLSearchParams("week=2026-10-12"))).toBeNull();
  });

  it("ignores an empty id", () => {
    expect(readDetailEntry(new URLSearchParams("child="))).toBeNull();
  });
});

describe("withDetailEntry", () => {
  it("swaps the open record and keeps other params", () => {
    const search = withDetailEntry(new URLSearchParams("week=2026-10-12&child=c-2"), {
      kind: "guardian",
      id: "g-1",
    });
    expect(search).toBe("?week=2026-10-12&guardian=g-1");
  });

  it("clears the open record", () => {
    expect(withDetailEntry(new URLSearchParams("guardian=g-1"), null)).toBe("");
  });
});
