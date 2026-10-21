import { describe, expect, it } from "vitest";
import type { ExceptionRead, TimeOffStatus } from "@/lib/queries/time-off";
import {
  canApprove,
  canCancel,
  canDecline,
  getBusinessNow,
  getOwnSection,
  getQueueTab,
  getTimeOffBadgeStatus,
  hasEnded,
} from "@/pages/time-off/lib/time-off-rules";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";

// Business wall-clock "now" for every case: Mon Oct 20 2031, 3:10 PM.
const NOW = "2031-10-20T15:10:00";

const TUTOR: Viewer = { id: "u-tutor", role: "tutor" };
const MANAGER: Viewer = { id: "u-manager", role: "manager" };
const ADMIN: Viewer = { id: "u-admin", role: "admin" };
const DEVELOPER: Viewer = { id: "u-dev", role: "developer" };

function makeItem(overrides: Partial<ExceptionRead> = {}): ExceptionRead {
  return {
    id: "to-1",
    staff: { id: TUTOR.id, name: "Marco Bell", role: "tutor" },
    start_date: "2031-10-21",
    end_date: "2031-10-22",
    start_time: null,
    end_time: null,
    reason: null,
    status: "pending",
    created_at: "2031-10-14T19:10:00Z",
    decided_by: null,
    decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    entered_by: null,
    clashing_bookings: [],
    clashing_bookings_count: 0,
    ...overrides,
  };
}

const LIVE = { start_date: "2031-10-21", end_date: "2031-10-22" };
const ENDED = { start_date: "2031-10-17", end_date: "2031-10-19" };

describe("hasEnded", () => {
  it("keeps an all-day window live through its last day", () => {
    const item = makeItem({ start_date: "2031-10-20", end_date: "2031-10-20" });
    expect(hasEnded(item, NOW)).toBe(false);
  });

  it("ends an all-day window the day after its last day", () => {
    expect(hasEnded(makeItem(ENDED), NOW)).toBe(true);
  });

  it("ends a part-day window at its end time on the last day", () => {
    const today = { start_date: "2031-10-20", end_date: "2031-10-20" };
    const endedAt3 = makeItem({
      ...today,
      start_time: "13:00:00",
      end_time: "15:00:00",
    });
    const endsAt5 = makeItem({
      ...today,
      start_time: "13:00:00",
      end_time: "17:00:00",
    });
    expect(hasEnded(endedAt3, NOW)).toBe(true);
    expect(hasEnded(endsAt5, NOW)).toBe(false);
  });
});

describe("getBusinessNow", () => {
  it("reads the clock in New York, whatever the viewer's zone", () => {
    // 01:30 UTC on the 21st is still 9:30 PM on the 20th in New York (EDT).
    const at = new Date("2031-10-21T01:30:00Z");
    expect(getBusinessNow(at)).toBe("2031-10-20T21:30:00");
  });
});

describe("getQueueTab and getOwnSection", () => {
  const cases: [TimeOffStatus, boolean, string, string][] = [
    ["pending", false, "pending", "waiting"],
    ["approved", false, "upcoming", "coming"],
    ["approved", true, "past", "history"],
    ["rejected", false, "declined-cancelled", "declined-cancelled"],
    ["rejected", true, "past", "history"],
    ["cancelled", false, "declined-cancelled", "declined-cancelled"],
    ["cancelled", true, "past", "history"],
    ["expired", false, "past", "history"],
    ["expired", true, "past", "history"],
  ];

  it.each(cases)(
    "puts %s (ended: %s) in the %s tab and the %s section",
    (status, isEnded, tab, section) => {
      const item = makeItem({ status, ...(isEnded ? ENDED : LIVE) });
      expect(getQueueTab(item, NOW)).toBe(tab);
      expect(getOwnSection(item, NOW)).toBe(section);
    },
  );
});

describe("canApprove and canDecline", () => {
  const cases: [TimeOffStatus, boolean, boolean, boolean][] = [
    ["pending", false, true, true],
    ["rejected", false, true, false],
    ["rejected", true, false, false],
    ["approved", false, false, false],
    ["cancelled", false, false, false],
    ["expired", true, false, false],
  ];

  it.each(cases)(
    "%s (ended: %s): approve %s, decline %s",
    (status, isEnded, approvable, declinable) => {
      const item = makeItem({ status, ...(isEnded ? ENDED : LIVE) });
      expect(canApprove(item, NOW)).toBe(approvable);
      expect(canDecline(item)).toBe(declinable);
    },
  );
});

describe("canCancel", () => {
  it("lets the owner cancel their own pending or approved Time off", () => {
    expect(canCancel(makeItem({ status: "pending" }), TUTOR, NOW)).toBe(true);
    expect(canCancel(makeItem({ status: "approved" }), TUTOR, NOW)).toBe(true);
  });

  it("lets a Manager cancel their own", () => {
    const own = makeItem({
      staff: { id: MANAGER.id, name: "Mia Lane", role: "manager" },
    });
    expect(canCancel(own, MANAGER, NOW)).toBe(true);
  });

  it("refuses the owner once it has ended, or once it is closed", () => {
    const ended = makeItem({ status: "approved", ...ENDED });
    expect(canCancel(ended, TUTOR, NOW)).toBe(false);
    for (const status of ["rejected", "cancelled", "expired"] as const) {
      expect(canCancel(makeItem({ status }), TUTOR, NOW)).toBe(false);
    }
  });

  it("lets an Admin or Developer cancel anyone's approved Time off", () => {
    const approved = makeItem({ status: "approved" });
    expect(canCancel(approved, ADMIN, NOW)).toBe(true);
    expect(canCancel(approved, DEVELOPER, NOW)).toBe(true);
  });

  it("never lets an Admin cancel someone else's pending request", () => {
    expect(canCancel(makeItem({ status: "pending" }), ADMIN, NOW)).toBe(false);
  });

  it("refuses an Admin once the approved Time off has ended", () => {
    const ended = makeItem({ status: "approved", ...ENDED });
    expect(canCancel(ended, ADMIN, NOW)).toBe(false);
  });

  it("never lets a Manager or another Tutor cancel someone else's", () => {
    const approved = makeItem({ status: "approved" });
    const otherTutor: Viewer = { id: "u-other", role: "tutor" };
    expect(canCancel(approved, MANAGER, NOW)).toBe(false);
    expect(canCancel(approved, otherTutor, NOW)).toBe(false);
  });
});

describe("getTimeOffBadgeStatus", () => {
  it("names each status in CONTEXT.md's words", () => {
    expect(getTimeOffBadgeStatus("pending")).toBe("Pending");
    expect(getTimeOffBadgeStatus("approved")).toBe("Approved");
    expect(getTimeOffBadgeStatus("rejected")).toBe("Declined");
    expect(getTimeOffBadgeStatus("cancelled")).toBe("Cancelled");
    expect(getTimeOffBadgeStatus("expired")).toBe("Expired");
  });
});
