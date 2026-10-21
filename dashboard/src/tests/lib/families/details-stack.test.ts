import { describe, expect, it } from "vitest";
import {
  keepClosingSlots,
  readDetailsStack,
  resolveDetailsStack,
} from "@/lib/families/details-stack";
import type { DetailEntry } from "@/lib/families/family-paths";

const CHILD: DetailEntry = { kind: "child", id: "c-1" };
const GUARDIAN: DetailEntry = { kind: "guardian", id: "g-1" };

describe("readDetailsStack", () => {
  it("reads the stack an in-app open left in history state", () => {
    expect(readDetailsStack({ familyDetails: [CHILD, GUARDIAN] })).toEqual([
      CHILD,
      GUARDIAN,
    ]);
  });

  it.each([
    ["no state", null],
    ["another page's state", { from: "/home" }],
    ["a malformed entry", { familyDetails: [{ kind: "home", id: "h-1" }] }],
    ["a missing id", { familyDetails: [{ kind: "child" }] }],
  ])("reads nothing from %s", (_name, state) => {
    expect(readDetailsStack(state)).toBeNull();
  });
});

describe("resolveDetailsStack", () => {
  it("is empty when the URL opens no record", () => {
    expect(resolveDetailsStack(null, [CHILD])).toEqual({
      stack: [],
      isDeepLink: false,
    });
  });

  it("uses the saved stack when its top is the URL's record", () => {
    expect(resolveDetailsStack(GUARDIAN, [CHILD, GUARDIAN])).toEqual({
      stack: [CHILD, GUARDIAN],
      isDeepLink: false,
    });
  });

  it("treats a URL record without a matching saved stack as a deep link", () => {
    expect(resolveDetailsStack(GUARDIAN, [CHILD])).toEqual({
      stack: [GUARDIAN],
      isDeepLink: true,
    });
    expect(resolveDetailsStack(CHILD, null)).toEqual({
      stack: [CHILD],
      isDeepLink: true,
    });
  });
});

describe("keepClosingSlots", () => {
  it("keeps a popped entry in its slot so it can play its exit", () => {
    expect(keepClosingSlots([CHILD, GUARDIAN], [CHILD])).toEqual([
      CHILD,
      GUARDIAN,
    ]);
  });

  it("puts a newly opened entry in the slot it fills", () => {
    const other: DetailEntry = { kind: "child", id: "c-2" };
    expect(keepClosingSlots([CHILD, GUARDIAN], [CHILD, other])).toEqual([
      CHILD,
      other,
    ]);
  });
});
