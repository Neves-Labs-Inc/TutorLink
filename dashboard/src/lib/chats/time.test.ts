import { describe, expect, it } from "vitest";
import {
  formatClockTime,
  formatDayAndTime,
  formatDayHeading,
  formatListTime,
  formatWeekLabel,
  isSameDay,
} from "@/lib/chats/time";

// Mon Oct 19 2026, 10:00 AM in New York (EDT, UTC-4).
const NOW = Date.parse("2026-10-19T14:00:00Z");

describe("formatClockTime", () => {
  it("uses the business zone", () => {
    expect(formatClockTime("2026-10-18T21:00:00Z")).toBe("5:00 PM");
  });
});

describe("formatListTime", () => {
  it("shows the time today", () => {
    expect(formatListTime("2026-10-19T12:31:00Z", NOW)).toBe("8:31 AM");
  });

  it("says Yesterday", () => {
    expect(formatListTime("2026-10-18T21:00:00Z", NOW)).toBe("Yesterday");
  });

  it("shows the weekday 2 to 6 days ago", () => {
    expect(formatListTime("2026-10-17T21:00:00Z", NOW)).toBe("Sat");
  });

  it("shows month and day when older", () => {
    expect(formatListTime("2026-10-04T21:00:00Z", NOW)).toBe("Oct 4");
  });

  it("adds the year for another year", () => {
    expect(formatListTime("2025-10-04T21:00:00Z", NOW)).toBe("Oct 4, 2025");
  });

  it("counts days in the business zone, not UTC", () => {
    // 11 PM Oct 18 in New York is already Oct 19 in UTC.
    expect(formatListTime("2026-10-19T03:00:00Z", NOW)).toBe("Yesterday");
  });
});

describe("formatDayHeading", () => {
  it("names today and yesterday", () => {
    expect(formatDayHeading("2026-10-19T12:31:00Z", NOW)).toBe("Today");
    expect(formatDayHeading("2026-10-18T21:00:00Z", NOW)).toBe("Yesterday");
  });

  it("spells out older days", () => {
    expect(formatDayHeading("2026-10-11T21:00:00Z", NOW)).toBe("Sunday, Oct 11");
  });

  it("adds the year for another year", () => {
    expect(formatDayHeading("2025-10-12T21:00:00Z", NOW)).toBe("Sunday, Oct 12, 2025");
  });
});

describe("formatDayAndTime", () => {
  it("joins day and clock time", () => {
    expect(formatDayAndTime("2026-10-18T21:00:00Z")).toBe("Sun, Oct 18, 5:00 PM");
  });
});

describe("formatWeekLabel", () => {
  it("labels a Monday", () => {
    expect(formatWeekLabel("2026-10-19")).toBe("Week of Oct 19");
  });
});

describe("isSameDay", () => {
  it("compares days in the business zone", () => {
    expect(isSameDay("2026-10-19T03:00:00Z", "2026-10-18T21:00:00Z")).toBe(true);
    expect(isSameDay("2026-10-19T14:00:00Z", "2026-10-18T21:00:00Z")).toBe(false);
  });
});
