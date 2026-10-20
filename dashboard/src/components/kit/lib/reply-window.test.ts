import { describe, expect, it } from "vitest";
import {
  formatTimeLeft,
  getReplyWindow,
  REPLY_WINDOW_MS,
} from "@/components/kit/lib/reply-window";

const LAST = "2026-10-18T12:00:00.000Z";
const LAST_MS = Date.parse(LAST);
const HOUR = 3_600_000;

describe("getReplyWindow", () => {
  it("is closed with no closing time when there is no client message", () => {
    expect(getReplyWindow(null, LAST_MS)).toEqual({
      isOpen: false,
      msLeft: 0,
      closesAt: null,
    });
  });

  it("is open with the time left inside 24 hours", () => {
    const result = getReplyWindow(LAST, LAST_MS + 19 * HOUR);
    expect(result).toEqual({
      isOpen: true,
      msLeft: 5 * HOUR,
      closesAt: "2026-10-19T12:00:00.000Z",
    });
  });

  it("is closed one millisecond after the 24 hours", () => {
    const result = getReplyWindow(LAST, LAST_MS + REPLY_WINDOW_MS + 1);
    expect(result.isOpen).toBe(false);
    expect(result.msLeft).toBe(0);
  });

  it("is closed at exactly 24 hours", () => {
    expect(getReplyWindow(LAST, LAST_MS + REPLY_WINDOW_MS).isOpen).toBe(false);
  });
});

describe("formatTimeLeft", () => {
  it("shows whole hours from an hour up", () => {
    expect(formatTimeLeft(5 * HOUR + 59 * 60_000)).toBe("5h");
  });

  it("shows minutes under an hour", () => {
    expect(formatTimeLeft(59 * 60_000)).toBe("59 min");
  });

  it("never shows less than a minute", () => {
    expect(formatTimeLeft(30_000)).toBe("1 min");
  });
});
