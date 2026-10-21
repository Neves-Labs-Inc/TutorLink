import { describe, expect, it } from "vitest";
import {
  toEditorSlots,
  toWeekPayload,
} from "@/lib/availability/availability-week";
import type { AvailabilitySlot as WireSlot } from "@/lib/queries/availability";

function wireSlot(overrides: Partial<WireSlot> = {}): WireSlot {
  return {
    id: "s-1",
    tutor_id: "t-1",
    day_of_week: 0,
    start_time: "15:00:00",
    end_time: "18:00:00",
    is_active: true,
    mode: "anywhere",
    ...overrides,
  };
}

describe("toEditorSlots", () => {
  it.each([
    ["traveler", "Home visits"],
    ["anywhere", "Home or office"],
    ["only_office", "Office only"],
  ] as const)("reads mode %s as %s", (mode, location) => {
    expect(toEditorSlots([wireSlot({ mode })])[0].location).toBe(location);
  });

  it.each([
    [0, "Monday"],
    [3, "Thursday"],
    [6, "Sunday"],
  ])("reads day_of_week %i as %s", (dayOfWeek, day) => {
    expect(toEditorSlots([wireSlot({ day_of_week: dayOfWeek })])[0].day).toBe(
      day,
    );
  });

  it("reads the times as HH:MM and keeps the slot id", () => {
    const [slot] = toEditorSlots([
      wireSlot({ id: "s-9", start_time: "08:30:00", end_time: "12:15:00" }),
    ]);
    expect(slot).toEqual({
      id: "s-9",
      day: "Monday",
      from: "08:30",
      to: "12:15",
      location: "Home or office",
    });
  });

  it("drops inactive slots", () => {
    const slots = toEditorSlots([
      wireSlot({ id: "on" }),
      wireSlot({ id: "off", is_active: false }),
    ]);
    expect(slots.map((slot) => slot.id)).toEqual(["on"]);
  });
});

describe("toWeekPayload", () => {
  it("builds the PUT body with day index, HH:MM:SS times and mode", () => {
    expect(
      toWeekPayload([
        {
          id: "a",
          day: "Tuesday",
          from: "09:00",
          to: "11:30",
          location: "Home visits",
        },
        {
          id: "b",
          day: "Sunday",
          from: "14:00",
          to: "16:00",
          location: "Office only",
        },
      ]),
    ).toEqual({
      slots: [
        {
          day_of_week: 1,
          start_time: "09:00:00",
          end_time: "11:30:00",
          mode: "traveler",
        },
        {
          day_of_week: 6,
          start_time: "14:00:00",
          end_time: "16:00:00",
          mode: "only_office",
        },
      ],
    });
  });

  it("sends an empty week as no slots", () => {
    expect(toWeekPayload([])).toEqual({ slots: [] });
  });
});
