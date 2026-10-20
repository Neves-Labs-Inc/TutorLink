import { describe, expect, it } from "vitest";
import { addWeeks, getWeekStart } from "@/lib/week";

describe("getWeekStart", () => {
  it.each([
    { day: "2026-10-19", expected: "2026-10-19" },
    { day: "2026-10-22", expected: "2026-10-19" },
    { day: "2026-10-25", expected: "2026-10-19" },
    { day: "2026-10-26", expected: "2026-10-26" },
  ])("puts $day in the week starting $expected", ({ day, expected }) => {
    expect(getWeekStart(day)).toBe(expected);
  });
});

describe("addWeeks", () => {
  it("moves a week start forward and back across a month end", () => {
    expect(addWeeks("2026-10-26", 1)).toBe("2026-11-02");
    expect(addWeeks("2026-10-05", -1)).toBe("2026-09-28");
  });
});
