import { describe, expect, it } from "vitest";
import {
  formatHour,
  formatNextSend,
  getNextSend,
  getNextCleanUp,
  getZoneAbbreviation,
  utcToZoneHour,
  zoneToUtcHour,
} from "@/lib/settings/office-time";

const NEW_YORK = "America/New_York";
// Tuesday 13 October 2026, 10:30 AM EDT.
const TUESDAY_MORNING = new Date("2026-10-13T14:30:00Z");
// Tuesday 13 January 2026, 10:30 AM EST.
const WINTER_MORNING = new Date("2026-01-13T15:30:00Z");

describe("office hour and UTC hour", () => {
  it("shows 7 UTC as 3:00 AM in New York on EDT", () => {
    expect(utcToZoneHour(7, NEW_YORK, TUESDAY_MORNING)).toBe(3);
  });

  it("writes a picked 2:00 AM back as 6 UTC on EDT", () => {
    expect(zoneToUtcHour(2, NEW_YORK, TUESDAY_MORNING)).toBe(6);
  });

  it("shifts by an hour on EST", () => {
    expect(utcToZoneHour(7, NEW_YORK, WINTER_MORNING)).toBe(2);
    expect(zoneToUtcHour(2, NEW_YORK, WINTER_MORNING)).toBe(7);
  });

  it("wraps across midnight", () => {
    expect(utcToZoneHour(2, NEW_YORK, TUESDAY_MORNING)).toBe(22);
    expect(zoneToUtcHour(22, NEW_YORK, TUESDAY_MORNING)).toBe(2);
  });
});

describe("labels", () => {
  it("formats hours as clock times", () => {
    expect(formatHour(0)).toBe("12:00 AM");
    expect(formatHour(9)).toBe("9:00 AM");
    expect(formatHour(12)).toBe("12:00 PM");
    expect(formatHour(23)).toBe("11:00 PM");
  });

  it("names the zone as it is on that day", () => {
    expect(getZoneAbbreviation(NEW_YORK, TUESDAY_MORNING)).toBe("EDT");
    expect(getZoneAbbreviation(NEW_YORK, WINTER_MORNING)).toBe("EST");
  });
});

describe("next reminder send", () => {
  it("is today when the weekday is today and the hour is ahead", () => {
    const next = getNextSend(2, 15, NEW_YORK, TUESDAY_MORNING);
    expect(formatNextSend(next)).toBe("Today at 3:00 PM");
  });

  it("is next week when today's hour has passed", () => {
    const next = getNextSend(2, 9, NEW_YORK, TUESDAY_MORNING);
    expect(formatNextSend(next)).toBe("Tue, Oct 20 at 9:00 AM");
  });

  it("finds the coming weekday", () => {
    const next = getNextSend(1, 9, NEW_YORK, TUESDAY_MORNING);
    expect(formatNextSend(next)).toBe("Mon, Oct 19 at 9:00 AM");
  });

  it("reads the business day, not the viewer's, near midnight", () => {
    // 10:30 PM Monday in New York is already Tuesday in UTC.
    const lateMonday = new Date("2026-10-13T02:30:00Z");
    const next = getNextSend(1, 23, NEW_YORK, lateMonday);
    expect(formatNextSend(next)).toBe("Today at 11:00 PM");
  });
});

describe("next clean-up", () => {
  it("is today when the hour is still ahead", () => {
    expect(getNextCleanUp(15, NEW_YORK, TUESDAY_MORNING)).toBe("today");
  });

  it("is tomorrow once the hour has started", () => {
    expect(getNextCleanUp(10, NEW_YORK, TUESDAY_MORNING)).toBe("tomorrow");
    expect(getNextCleanUp(3, NEW_YORK, TUESDAY_MORNING)).toBe("tomorrow");
  });
});
