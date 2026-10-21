import { describe, expect, it } from "vitest";
import {
  describeArchived,
  describeCascade,
  guardianArchiveCascade,
  joinNames,
} from "@/lib/families/guardian-archive";
import type { CascadeFamily } from "@/lib/families/guardian-archive";

const LAURA = { id: "g-1", archived: false };
const DIEGO = { id: "g-2", archived: false };
const SOFIA = { id: "c-1", name: "Sofia", archived: false, upcomingSessionCount: 2 };
const MATEO = { id: "c-2", name: "Mateo", archived: false, upcomingSessionCount: 3 };

describe("guardianArchiveCascade", () => {
  it("archives no Child while another Guardian is still active", () => {
    const family: CascadeFamily = {
      guardians: [LAURA, DIEGO],
      children: [SOFIA, MATEO],
    };

    expect(guardianArchiveCascade(family, "g-1")).toEqual({
      children: [],
      cancellations: 0,
    });
  });

  it("archives every live Child, with their upcoming Bookings, when they're the last active Guardian", () => {
    const family: CascadeFamily = {
      guardians: [LAURA, { ...DIEGO, archived: true }],
      children: [SOFIA, MATEO],
    };

    expect(guardianArchiveCascade(family, "g-1")).toEqual({
      children: [
        { id: "c-1", name: "Sofia" },
        { id: "c-2", name: "Mateo" },
      ],
      cancellations: 5,
    });
  });

  it("leaves Children already archived out of the names and the count", () => {
    const family: CascadeFamily = {
      guardians: [LAURA],
      children: [SOFIA, { ...MATEO, archived: true }],
    };

    expect(guardianArchiveCascade(family, "g-1")).toEqual({
      children: [{ id: "c-1", name: "Sofia" }],
      cancellations: 2,
    });
  });

  it("cascades nothing when the Guardian is already archived", () => {
    const family: CascadeFamily = {
      guardians: [{ ...LAURA, archived: true }],
      children: [SOFIA],
    };

    expect(guardianArchiveCascade(family, "g-1")).toEqual({
      children: [],
      cancellations: 0,
    });
  });

  it("names the Children even when none has an upcoming Booking", () => {
    const family: CascadeFamily = {
      guardians: [LAURA],
      children: [{ ...SOFIA, upcomingSessionCount: 0 }],
    };

    expect(guardianArchiveCascade(family, "g-1")).toEqual({
      children: [{ id: "c-1", name: "Sofia" }],
      cancellations: 0,
    });
  });
});

describe("joinNames", () => {
  it.each([
    [["Sofia"], "Sofia"],
    [["Sofia", "Mateo"], "Sofia and Mateo"],
    [["Sofia", "Mateo", "Lucas"], "Sofia, Mateo and Lucas"],
  ])("joins %j as %s", (names, joined) => {
    expect(joinNames(names)).toBe(joined);
  });
});

describe("describeCascade", () => {
  it("names the Children and their upcoming Bookings", () => {
    expect(
      describeCascade({
        children: [
          { id: "c-1", name: "Sofia" },
          { id: "c-2", name: "Mateo" },
        ],
        cancellations: 3,
      }),
    ).toBe(
      "They’re the family’s last active Guardian, so Sofia and Mateo are archived too and their 3 upcoming Bookings are cancelled. Restore won’t bring those back.",
    );
  });

  it("words one Child and one Booking", () => {
    expect(
      describeCascade({
        children: [{ id: "c-1", name: "Sofia" }],
        cancellations: 1,
      }),
    ).toBe(
      "They’re the family’s last active Guardian, so Sofia is archived too and their 1 upcoming Booking is cancelled. Restore won’t bring those back.",
    );
  });

  it("leaves Bookings out when there are none", () => {
    expect(
      describeCascade({
        children: [{ id: "c-1", name: "Sofia" }],
        cancellations: 0,
      }),
    ).toBe(
      "They’re the family’s last active Guardian, so Sofia is archived too. Restore won’t bring them back.",
    );
  });

  it("says nothing without a cascade", () => {
    expect(describeCascade({ children: [], cancellations: 0 })).toBeNull();
  });
});

describe("describeArchived", () => {
  it("says the Guardian was archived", () => {
    expect(describeArchived("Laura", [], 0)).toBe("Laura archived.");
  });

  it("adds the Children and Bookings the archive took", () => {
    expect(describeArchived("Laura", ["Sofia", "Mateo"], 3)).toBe(
      "Laura archived. Sofia and Mateo archived and 3 Bookings cancelled.",
    );
  });

  it("adds just the Children when no Booking was cancelled", () => {
    expect(describeArchived("Laura", ["Sofia"], 0)).toBe(
      "Laura archived. Sofia archived.",
    );
  });
});
