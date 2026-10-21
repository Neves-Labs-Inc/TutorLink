import { describe, expect, it } from "vitest";
import {
  describeAssignedTutorNote,
  getStaffChoices,
  pickAvailabilityId,
} from "@/lib/bookings/booking-form";
import type { AvailabilitySlot } from "@/lib/queries/availability";
import type { OfficeTimeOff } from "@/lib/queries/exceptions";
import type { AvailableSlot } from "@/lib/queries/slots";
import type { StaffRead } from "@/lib/queries/staff";

// Thursday.
const DATE = "2099-10-15";
const MATH = { id: "s-math", name: "Math" };

function makeStaff(overrides: Partial<StaffRead> & Pick<StaffRead, "id" | "name">): StaffRead {
  return {
    role: "tutor",
    tutor_id: `t-${overrides.id}`,
    email: `${overrides.id}@example.com`,
    sign_in_state: "active",
    invite_expires_at: null,
    archived: false,
    subjects: [{ ...MATH, max_grade_level: 12 }],
    sessions_this_week: 0,
    assigned_children: [],
    phone_number: null,
    bio: null,
    has_pending_time_off: false,
    ...overrides,
  };
}

function makeSlot(staff: StaffRead, start: string, end: string): AvailableSlot {
  return {
    tutor_id: staff.tutor_id ?? "",
    tutor_name: staff.name,
    availability_id: `a-${staff.id}`,
    date: DATE,
    start_time: start,
    end_time: end,
  };
}

function makeTimeOff(staff: StaffRead): OfficeTimeOff {
  return {
    id: `x-${staff.id}`,
    staff: { id: staff.id, name: staff.name, role: staff.role },
    start_date: DATE,
    end_date: DATE,
    start_time: null,
    end_time: null,
    status: "approved",
  };
}

const ana = makeStaff({ id: "ana", name: "Ana Souza" });
const bia = makeStaff({ id: "bia", name: "Bia Reis" });
const caio = makeStaff({ id: "caio", name: "Caio Lima", subjects: [] });
const dora = makeStaff({ id: "dora", name: "Dora Admin", role: "admin", tutor_id: null });
const eva = makeStaff({ id: "eva", name: "Eva Manager", role: "manager", tutor_id: null });
const fabio = makeStaff({ id: "fabio", name: "Fabio Off" });

describe("getStaffChoices for Tutoring", () => {
  const choices = getStaffChoices({
    kind: "regular",
    staff: [dora, caio, bia, ana, eva, fabio],
    assignedIds: ["ana"],
    subject: MATH,
    date: DATE,
    slots: [makeSlot(bia, "16:00:00", "17:00:00"), makeSlot(bia, "15:30:00", "16:30:00")],
    timeOff: [makeTimeOff(fabio)],
  });

  it("puts Assigned Tutors first, then those who teach the Subject, then the rest", () => {
    expect(choices.map((choice) => choice.staff.id)).toEqual([
      "ana",
      "dora",
      "bia",
      "fabio",
      "caio",
    ]);
  });

  it("leaves out a Manager with no teaching profile", () => {
    expect(choices.some((choice) => choice.staff.id === "eva")).toBe(false);
  });

  it("describes each Staff member's day", () => {
    expect(Object.fromEntries(choices.map((c) => [c.staff.id, c.description]))).toEqual({
      ana: "Assigned Tutor · Teaches Math · no free time that day",
      dora: "Teaches Math · no set availability",
      bia: "Teaches Math · free from 3:30 PM",
      fabio: "Off Thursday (Time off)",
      caio: "Not set up for Math",
    });
  });

  it("says only that they teach it while free times are unknown", () => {
    const [choice] = getStaffChoices({
      kind: "regular",
      staff: [bia],
      assignedIds: [],
      subject: MATH,
      date: DATE,
      slots: null,
      timeOff: [],
    });
    expect(choice.description).toBe("Teaches Math");
  });
});

describe("getStaffChoices for an Evaluation", () => {
  it("offers only Admins and Managers, by role or Time off", () => {
    const offManager = makeStaff({ id: "gil", name: "Gil Off", role: "manager" });
    const choices = getStaffChoices({
      kind: "evaluation",
      staff: [ana, dora, eva, offManager],
      assignedIds: ["ana"],
      subject: null,
      date: DATE,
      slots: null,
      timeOff: [makeTimeOff(offManager)],
    });
    expect(choices.map((c) => [c.staff.id, c.description])).toEqual([
      ["dora", "Admin"],
      ["eva", "Manager"],
      ["gil", "Off Thursday (Time off)"],
    ]);
  });
});

describe("describeAssignedTutorNote", () => {
  const child = { name: "Emma Souza" };

  it("says a Child with no Assigned Tutors goes to the office, naming the pick", () => {
    expect(describeAssignedTutorNote({ child, assigned: [], picked: ana })).toBe(
      "Emma has no Assigned Tutors, so the bot hands their requests to the office. You can still book Ana; assign Tutors on Emma’s details.",
    );
  });

  it("says anyone can be booked when nobody is picked yet", () => {
    expect(describeAssignedTutorNote({ child, assigned: [], picked: null })).toBe(
      "Emma has no Assigned Tutors, so the bot hands their requests to the office. You can still book anyone.",
    );
  });

  it("warns when the pick isn't one of the Assigned Tutors", () => {
    const assigned = [{ id: "ana", name: "Ana Souza", role: "tutor" as const }];
    expect(describeAssignedTutorNote({ child, assigned, picked: bia })).toBe(
      "Bia isn’t one of Emma’s Assigned Tutors (Ana Souza). You can still book; the bot won’t offer Bia to Emma’s family.",
    );
  });

  it("explains that an Admin is never an Assigned Tutor", () => {
    const assigned = [{ id: "ana", name: "Ana Souza", role: "tutor" as const }];
    expect(describeAssignedTutorNote({ child, assigned, picked: dora })).toBe(
      "Dora is an Admin, so never one of Emma’s Assigned Tutors (Ana Souza). You can still book; the bot won’t offer Dora to Emma’s family.",
    );
  });

  it("says nothing when the pick is assigned", () => {
    const assigned = [{ id: "ana", name: "Ana Souza", role: "tutor" as const }];
    expect(describeAssignedTutorNote({ child, assigned, picked: ana })).toBeNull();
  });
});

describe("pickAvailabilityId", () => {
  function makeRange(id: string, day: number, start: string, end: string): AvailabilitySlot {
    return {
      id,
      tutor_id: "t-ana",
      day_of_week: day,
      start_time: start,
      end_time: end,
      is_active: true,
      mode: "anywhere",
    };
  }
  // 2099-10-15 is a Thursday: day 3.
  const ranges = [
    makeRange("mon", 0, "09:00:00", "17:00:00"),
    makeRange("thu-am", 3, "08:00:00", "12:00:00"),
    makeRange("thu-pm", 3, "14:00:00", "18:00:00"),
  ];

  it("names the range the time sits in", () => {
    expect(pickAvailabilityId(ranges, DATE, "15:00:00", "16:00:00")).toBe("thu-pm");
  });

  it("falls back to a range that day, so the API can warn outside_slot", () => {
    expect(pickAvailabilityId(ranges, DATE, "19:00:00", "20:00:00")).toBe("thu-am");
  });

  it("falls back to any active range when the day has none", () => {
    expect(pickAvailabilityId(ranges, "2099-10-17", "10:00:00", "11:00:00")).toBe("mon");
  });

  it("is null with no ranges", () => {
    expect(pickAvailabilityId([], DATE, "10:00:00", "11:00:00")).toBeNull();
  });
});
