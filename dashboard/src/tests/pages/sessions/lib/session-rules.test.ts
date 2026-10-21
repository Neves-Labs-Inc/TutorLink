import { describe, expect, it } from "vitest";
import {
  canMarkCompleted,
  findNextUp,
  getStartsIn,
  groupByDay,
  isNotMarked,
} from "@/pages/sessions/lib/session-rules";
import type { SessionTiming } from "@/pages/sessions/lib/session-rules";

// 3:05 PM on Tuesday, October 20 2026 in New York (EDT, UTC-4).
const NOW = new Date("2026-10-20T19:05:00Z");

function session(
  scheduled_date: string,
  start_time: string,
  end_time: string,
  status: SessionTiming["status"] = "confirmed",
): SessionTiming & { id: string } {
  return { id: `${scheduled_date} ${start_time}`, scheduled_date, start_time, end_time, status };
}

describe("groupByDay", () => {
  it("groups sessions under their day, keeping the given order", () => {
    const sessions = [
      session("2026-10-20", "15:30:00", "16:30:00"),
      session("2026-10-20", "17:00:00", "18:00:00"),
      session("2026-10-22", "09:00:00", "10:00:00"),
    ];

    expect(groupByDay(sessions)).toEqual([
      { dayKey: "2026-10-20", sessions: [sessions[0], sessions[1]] },
      { dayKey: "2026-10-22", sessions: [sessions[2]] },
    ]);
  });

  it("keeps a most-recent-first list most recent first", () => {
    const sessions = [
      session("2026-10-19", "17:00:00", "18:00:00"),
      session("2026-10-19", "15:00:00", "16:00:00"),
      session("2026-10-12", "15:00:00", "16:00:00"),
    ];

    expect(groupByDay(sessions).map((group) => group.dayKey)).toEqual([
      "2026-10-19",
      "2026-10-12",
    ]);
  });
});

describe("findNextUp", () => {
  it("skips Cancelled sessions and ones that have ended", () => {
    const ended = session("2026-10-20", "13:00:00", "14:00:00");
    const cancelled = session("2026-10-20", "15:30:00", "16:30:00", "cancelled");
    const next = session("2026-10-20", "17:00:00", "18:00:00", "pending");

    expect(findNextUp([ended, cancelled, next], NOW)).toBe(next);
  });

  it("picks a session that is happening now", () => {
    const live = session("2026-10-20", "15:00:00", "16:00:00");

    expect(findNextUp([live], NOW)).toBe(live);
  });

  it("is null when nothing is coming up", () => {
    expect(findNextUp([session("2026-10-21", "09:00:00", "10:00:00", "cancelled")], NOW)).toBeNull();
  });
});

describe("isNotMarked", () => {
  it("is true for a Pending or Confirmed session whose end has passed", () => {
    expect(isNotMarked(session("2026-10-20", "13:00:00", "15:00:00"), NOW)).toBe(true);
    expect(isNotMarked(session("2026-10-19", "13:00:00", "14:00:00", "pending"), NOW)).toBe(true);
  });

  it("is false while the session is still running", () => {
    expect(isNotMarked(session("2026-10-20", "14:30:00", "15:30:00"), NOW)).toBe(false);
  });

  it("is false once the session is Completed, Didn't happen or Cancelled", () => {
    expect(isNotMarked(session("2026-10-19", "13:00:00", "14:00:00", "completed"), NOW)).toBe(false);
    expect(isNotMarked(session("2026-10-19", "13:00:00", "14:00:00", "didnt_happen"), NOW)).toBe(false);
    expect(isNotMarked(session("2026-10-19", "13:00:00", "14:00:00", "cancelled"), NOW)).toBe(false);
  });
});

describe("canMarkCompleted", () => {
  it("allows a Confirmed session once it has started", () => {
    expect(canMarkCompleted(session("2026-10-20", "15:05:00", "16:05:00"), NOW)).toBe(true);
    expect(canMarkCompleted(session("2026-10-19", "13:00:00", "14:00:00"), NOW)).toBe(true);
  });

  it("refuses a Confirmed session that hasn't started", () => {
    expect(canMarkCompleted(session("2026-10-20", "15:30:00", "16:30:00"), NOW)).toBe(false);
  });

  it("refuses a Pending session, even one that has ended", () => {
    expect(canMarkCompleted(session("2026-10-19", "13:00:00", "14:00:00", "pending"), NOW)).toBe(false);
  });
});

describe("getStartsIn", () => {
  it("says Happening now between start and end", () => {
    expect(getStartsIn(session("2026-10-20", "15:00:00", "16:00:00"), NOW)).toBe("Happening now");
  });

  it("counts minutes inside the hour", () => {
    expect(getStartsIn(session("2026-10-20", "15:30:00", "16:30:00"), NOW)).toBe("In 25 min");
  });

  it("names the time later today", () => {
    expect(getStartsIn(session("2026-10-20", "17:30:00", "18:30:00"), NOW)).toBe(
      "Today at 5:30 PM",
    );
  });

  it("says Tomorrow for the next business day", () => {
    expect(getStartsIn(session("2026-10-21", "09:00:00", "10:00:00"), NOW)).toBe(
      "Tomorrow at 9:00 AM",
    );
  });

  it("names the weekday within the coming week", () => {
    expect(getStartsIn(session("2026-10-26", "15:30:00", "16:30:00"), NOW)).toBe(
      "Monday at 3:30 PM",
    );
  });

  it("adds the date beyond the coming week", () => {
    expect(getStartsIn(session("2026-10-28", "15:30:00", "16:30:00"), NOW)).toBe(
      "Wed, Oct 28 at 3:30 PM",
    );
  });

  it("counts minutes across midnight", () => {
    const lateNight = new Date("2026-10-21T03:50:00Z"); // 11:50 PM on the 20th in New York

    expect(getStartsIn(session("2026-10-21", "00:10:00", "01:00:00"), lateNight)).toBe(
      "In 20 min",
    );
  });

  it("uses the business day, not the UTC day", () => {
    // 10:30 PM on the 20th in New York, already the 21st in UTC.
    const evening = new Date("2026-10-21T02:30:00Z");

    expect(getStartsIn(session("2026-10-21", "09:00:00", "10:00:00"), evening)).toBe(
      "Tomorrow at 9:00 AM",
    );
  });

  it("follows New York across the end of daylight saving", () => {
    // 8:00 AM on Sunday, November 1 in New York (EST, UTC-5).
    const morning = new Date("2026-11-01T13:00:00Z");

    expect(getStartsIn(session("2026-11-01", "08:30:00", "09:30:00"), morning)).toBe("In 30 min");
  });
});
