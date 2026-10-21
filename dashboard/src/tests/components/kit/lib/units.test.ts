import { describe, expect, it } from "vitest";
import {
  HOURS_UNITS,
  RETENTION_UNITS,
  SECONDS_UNITS,
  formatDuration,
  joinDuration,
  splitDuration,
} from "@/components/kit/lib/units";

describe("duration units", () => {
  it("shows 900 seconds as 15 minutes", () => {
    expect(splitDuration("900", SECONDS_UNITS)).toEqual({ amount: "15", unitId: "minutes" });
  });

  it("picks the largest unit that divides evenly", () => {
    expect(splitDuration("48", HOURS_UNITS)).toEqual({ amount: "2", unitId: "days" });
    expect(splitDuration("50", HOURS_UNITS)).toEqual({ amount: "50", unitId: "hours" });
  });

  it("stores number plus unit as the base value", () => {
    expect(joinDuration({ amount: "2", unitId: "days" }, HOURS_UNITS)).toBe("48");
    expect(joinDuration({ amount: "2", unitId: "years" }, RETENTION_UNITS)).toBe("730");
  });

  it("leaves unparseable input untouched so the field can flag it", () => {
    expect(joinDuration({ amount: "", unitId: "days" }, HOURS_UNITS)).toBe("");
    expect(joinDuration({ amount: "abc", unitId: "days" }, HOURS_UNITS)).toBe("abc");
  });

  it("keeps a zero or non-integer value in the first unit", () => {
    expect(splitDuration("0", HOURS_UNITS)).toEqual({ amount: "0", unitId: "hours" });
    expect(splitDuration("x", HOURS_UNITS)).toEqual({ amount: "x", unitId: "hours" });
  });

  it("round-trips split then join", () => {
    const parts = splitDuration("730", RETENTION_UNITS);
    expect(joinDuration(parts, RETENTION_UNITS)).toBe("730");
  });

  it("formats singular and plural", () => {
    expect(formatDuration(1, HOURS_UNITS)).toBe("1 hour");
    expect(formatDuration(72, HOURS_UNITS)).toBe("3 days");
  });
});
