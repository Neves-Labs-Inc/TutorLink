import { describe, expect, it } from "vitest";
import type { ExceptionRead } from "@/lib/queries/time-off";
import {
  formatStamp,
  formatTimeOffDates,
  formatTimeOffLength,
  getStatusSentence,
} from "@/pages/time-off/lib/time-off-copy";

const MARCO = { id: "u-tutor", name: "Marco Bell" };
const RITA = { id: "u-admin", name: "Rita Souza" };
// 19:10 UTC is 3:10 PM in New York (EDT).
const OCT_14_310PM = "2031-10-14T19:10:00Z";
const OCT_15_9AM = "2031-10-15T13:00:00Z";

function makeItem(overrides: Partial<ExceptionRead> = {}): ExceptionRead {
  return {
    id: "to-1",
    staff: { ...MARCO, role: "tutor" },
    start_date: "2031-10-20",
    end_date: "2031-10-22",
    start_time: null,
    end_time: null,
    reason: null,
    status: "pending",
    created_at: OCT_14_310PM,
    decided_by: null,
    decided_at: null,
    cancelled_by: null,
    cancelled_at: null,
    entered_by: MARCO,
    clashing_bookings: [],
    clashing_bookings_count: 0,
    ...overrides,
  };
}

describe("getStatusSentence", () => {
  describe("pending", () => {
    it("tells the owner they can still be booked", () => {
      expect(getStatusSentence(makeItem(), MARCO.id)).toBe(
        "Waiting for an Admin. You can still be booked until it’s approved.",
      );
    });

    it("tells anyone else it awaits a decision", () => {
      expect(getStatusSentence(makeItem(), RITA.id)).toBe(
        "Waiting for an Admin to approve or decline.",
      );
    });
  });

  describe("approved", () => {
    const decided = makeItem({
      status: "approved",
      decided_by: RITA,
      decided_at: OCT_15_9AM,
    });

    it("names the Admin who approved it, to the owner", () => {
      expect(getStatusSentence(decided, MARCO.id)).toBe(
        "Approved by Rita, Oct 15, 9:00 AM. You can’t be booked in these times.",
      );
    });

    it("says “you” to the Admin who approved it", () => {
      expect(getStatusSentence(decided, RITA.id)).toBe(
        "Approved by you, Oct 15, 9:00 AM. They can’t be booked in these times.",
      );
    });

    it("says an Admin’s own entry needed no approval", () => {
      const own = makeItem({
        staff: { ...RITA, role: "admin" },
        status: "approved",
        entered_by: RITA,
        decided_by: RITA,
        decided_at: OCT_14_310PM,
      });
      expect(getStatusSentence(own, RITA.id)).toBe(
        "Took effect straight away: an Admin’s own time off needs no approval.",
      );
    });

    it("says who added it for someone else, by name", () => {
      const entered = makeItem({
        status: "approved",
        entered_by: RITA,
        decided_by: RITA,
        decided_at: OCT_14_310PM,
      });
      expect(getStatusSentence(entered, MARCO.id)).toBe(
        "Added by Rita, so it took effect straight away. You can’t be booked in these times.",
      );
      expect(getStatusSentence(entered, RITA.id)).toBe(
        "Added by you, so it took effect straight away. They can’t be booked in these times.",
      );
    });

    it("falls back to “an Admin” on rows with no decider recorded", () => {
      const legacy = makeItem({ status: "approved", entered_by: null });
      expect(getStatusSentence(legacy, MARCO.id)).toBe(
        "Approved by an Admin, Oct 14, 3:10 PM. You can’t be booked in these times.",
      );
    });
  });

  describe("rejected", () => {
    const declined = makeItem({
      status: "rejected",
      decided_by: RITA,
      decided_at: OCT_15_9AM,
    });

    it("tells the owner who declined it and that they can be booked", () => {
      expect(getStatusSentence(declined, MARCO.id)).toBe(
        "Declined by Rita, Oct 15, 9:00 AM. You can still be booked.",
      );
    });

    it("says “you” and “they” to the Admin who declined it", () => {
      expect(getStatusSentence(declined, RITA.id)).toBe(
        "Declined by you, Oct 15, 9:00 AM. They can still be booked.",
      );
    });
  });

  describe("cancelled", () => {
    it("says “you” to whoever cancelled it", () => {
      const own = makeItem({
        status: "cancelled",
        cancelled_by: MARCO,
        cancelled_at: OCT_15_9AM,
      });
      expect(getStatusSentence(own, MARCO.id)).toBe(
        "Cancelled by you, Oct 15, 9:00 AM.",
      );
    });

    it("names whoever cancelled it to anyone else", () => {
      const byAdmin = makeItem({
        status: "cancelled",
        cancelled_by: RITA,
        cancelled_at: OCT_15_9AM,
      });
      expect(getStatusSentence(byAdmin, MARCO.id)).toBe(
        "Cancelled by Rita, Oct 15, 9:00 AM.",
      );
    });
  });

  it("explains that an expired request never took effect", () => {
    expect(getStatusSentence(makeItem({ status: "expired" }), MARCO.id)).toBe(
      "Nobody decided before it started, so it never took effect.",
    );
  });
});

describe("formatTimeOffDates", () => {
  it("shows one day", () => {
    const window = { start_date: "2031-10-20", end_date: "2031-10-20" };
    expect(
      formatTimeOffDates({ ...window, start_time: null, end_time: null }),
    ).toBe("Mon, Oct 20");
  });

  it("shows a range of days", () => {
    expect(formatTimeOffDates(makeItem())).toBe("Mon, Oct 20 – Wed, Oct 22");
  });

  it("adds the hours of a part-day window", () => {
    const partDay = makeItem({ start_time: "13:00:00", end_time: "17:00:00" });
    expect(formatTimeOffDates(partDay)).toBe(
      "Mon, Oct 20 – Wed, Oct 22 · 1:00 PM – 5:00 PM",
    );
  });
});

describe("formatTimeOffLength", () => {
  it("counts whole days, both ends included", () => {
    const oneDay = makeItem({ end_date: "2031-10-20" });
    expect(formatTimeOffLength(oneDay)).toBe("1 day");
    expect(formatTimeOffLength(makeItem())).toBe("3 days");
  });

  it("counts days across a month end", () => {
    const window = makeItem({ start_date: "2031-10-30", end_date: "2031-11-02" });
    expect(formatTimeOffLength(window)).toBe("4 days");
  });

  it("gives the hours on each day of a part-day window", () => {
    const partDay = makeItem({ start_time: "13:00:00", end_time: "17:00:00" });
    expect(formatTimeOffLength(partDay)).toBe("4 hours on each day");
  });

  it("gives the hours alone for a single part day", () => {
    const partDay = makeItem({
      end_date: "2031-10-20",
      start_time: "13:00:00",
      end_time: "14:00:00",
    });
    expect(formatTimeOffLength(partDay)).toBe("1 hour");
  });

  it("keeps the minutes of an uneven part day", () => {
    const partDay = makeItem({ start_time: "13:00:00", end_time: "15:30:00" });
    expect(formatTimeOffLength(partDay)).toBe(
      "2 hours 30 minutes on each day",
    );
  });
});

describe("formatStamp", () => {
  it("shows the moment on the business clock", () => {
    expect(formatStamp(OCT_14_310PM)).toBe("Oct 14, 3:10 PM");
  });
});
