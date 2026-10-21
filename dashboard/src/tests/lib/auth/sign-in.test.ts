import { describe, expect, it } from "vitest";
import {
  formatWait,
  getSignInFailure,
  parseRetryAfter,
} from "@/lib/auth/sign-in";

const NOW = 1_000_000;
const FIFTEEN_MINUTES_S = 900;

describe("formatWait", () => {
  it("rounds up to whole minutes", () => {
    expect(formatWait(300)).toBe("5 minutes");
    expect(formatWait(301)).toBe("6 minutes");
    expect(formatWait(61)).toBe("2 minutes");
  });

  it("says 1 minute for the last minute, never less", () => {
    expect(formatWait(60)).toBe("1 minute");
    expect(formatWait(1)).toBe("1 minute");
    expect(formatWait(0)).toBe("1 minute");
  });
});

describe("parseRetryAfter", () => {
  it("reads whole seconds", () => {
    expect(parseRetryAfter("300")).toBe(300);
  });

  it("falls back to 15 minutes when the header is missing or unreadable", () => {
    for (const header of [null, "", "soon", "-5", "0", "Wed, 21 Oct 2026 07:28:00 GMT"]) {
      expect(parseRetryAfter(header)).toBe(FIFTEEN_MINUTES_S);
    }
  });
});

describe("getSignInFailure", () => {
  it("reads a 401 as wrong details", () => {
    expect(getSignInFailure(401, null, NOW)).toEqual({ kind: "wrong" });
  });

  it("reads a 429 as a lockout ending Retry-After seconds from now", () => {
    expect(getSignInFailure(429, "300", NOW)).toEqual({
      kind: "locked",
      lockout: { from: NOW, until: NOW + 300_000 },
    });
  });

  it("reads no response or a 5xx as unreachable", () => {
    expect(getSignInFailure(null, null, NOW)).toEqual({ kind: "unreachable" });
    expect(getSignInFailure(503, null, NOW)).toEqual({ kind: "unreachable" });
  });
});
