import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/auth";
import type { StaffRead } from "@/lib/queries/staff";
import { getSetupChecklist } from "@/pages/staff/lib/setup-checklist";
import type { SlotCount } from "@/pages/staff/lib/setup-checklist";
import { getStaffPermissions } from "@/pages/staff/lib/staff-permissions";

const VIEWER_ID = "u-viewer";

function makeStaff(overrides: Partial<StaffRead> = {}): StaffRead {
  return {
    id: "u-ana",
    name: "Ana Brooks",
    role: "tutor",
    tutor_id: "t-ana",
    email: "ana@example.com",
    sign_in_state: "not_invited",
    invite_expires_at: null,
    archived: false,
    subjects: [],
    sessions_this_week: 0,
    assigned_children: [],
    phone_number: "+15550102000",
    bio: null,
    has_pending_time_off: false,
    ...overrides,
  };
}

const MATHS = { id: "s-maths", name: "Maths", max_grade_level: 8 };
const READING = { id: "s-reading", name: "Reading", max_grade_level: 0 };

function checklistFor(
  staff: StaffRead,
  slotCount: SlotCount = 0,
  viewerRole: Role = "admin",
) {
  const can = getStaffPermissions(viewerRole, VIEWER_ID, staff);
  return getSetupChecklist(staff, viewerRole, can, slotCount);
}

describe("getSetupChecklist for a Tutor or Manager", () => {
  it("lists Subjects, Availability and Invite, none done, each with its act", () => {
    const checklist = checklistFor(makeStaff());
    expect(checklist).toEqual({
      doneCount: 0,
      steps: [
        {
          id: "subjects",
          label: "Subjects",
          detail: "What they teach, and up to which grade",
          isDone: false,
          actLabel: "Add subjects",
        },
        {
          id: "availability",
          label: "Availability",
          detail: "When Guardians can book them",
          isDone: false,
          actLabel: "Set availability",
        },
        {
          id: "invite",
          label: "Invite",
          detail: "An email to ana@example.com to choose a password",
          isDone: false,
          actLabel: "Send invite",
        },
      ],
    });
  });

  it("marks Subjects done with their names, and drops its act", () => {
    const checklist = checklistFor(makeStaff({ subjects: [MATHS, READING] }));
    expect(checklist?.steps[0]).toEqual({
      id: "subjects",
      label: "Subjects",
      detail: "Maths, Reading",
      isDone: true,
      actLabel: null,
    });
    expect(checklist?.doneCount).toBe(1);
  });

  it("marks Availability done with its count of time ranges", () => {
    const checklist = checklistFor(makeStaff({ role: "manager" }), 3);
    expect(checklist?.steps[1]).toEqual({
      id: "availability",
      label: "Availability",
      detail: "3 time ranges a week",
      isDone: true,
      actLabel: null,
    });
  });

  it("marks Invite done once sent", () => {
    const checklist = checklistFor(makeStaff({ sign_in_state: "invited" }));
    expect(checklist?.steps[2]).toEqual({
      id: "invite",
      label: "Invite",
      detail: "Sent. They sign in once they choose a password.",
      isDone: true,
      actLabel: null,
    });
  });

  it("shows Availability as loading, with no act, until the count arrives", () => {
    const checklist = checklistFor(makeStaff(), "loading");
    expect(checklist?.steps[1]).toMatchObject({
      detail: null,
      isDone: false,
      actLabel: null,
    });
  });

  it("keeps the act when the count couldn't load", () => {
    const checklist = checklistFor(makeStaff(), "failed");
    expect(checklist?.steps[1]).toMatchObject({
      detail: "When Guardians can book them",
      isDone: false,
      actLabel: "Set availability",
    });
  });

  it("is hidden once every step is done", () => {
    const staff = makeStaff({ subjects: [MATHS], sign_in_state: "active" });
    expect(checklistFor(staff, 2)).toBeNull();
  });
});

describe("getSetupChecklist for an Admin", () => {
  const ADMIN = makeStaff({
    id: "u-dan",
    role: "admin",
    tutor_id: null,
    email: "dan@example.com",
    phone_number: null,
  });

  it("lists only Invite", () => {
    expect(checklistFor(ADMIN)).toEqual({
      doneCount: 0,
      steps: [
        {
          id: "invite",
          label: "Invite",
          detail: "An email to dan@example.com to choose a password",
          isDone: false,
          actLabel: "Send invite",
        },
      ],
    });
  });

  it("is hidden once they're invited", () => {
    expect(checklistFor({ ...ADMIN, sign_in_state: "invited" })).toBeNull();
  });
});

describe("getSetupChecklist hides itself", () => {
  it("from a Manager viewer", () => {
    expect(checklistFor(makeStaff(), 0, "manager")).toBeNull();
  });

  it("on archived Staff", () => {
    expect(checklistFor(makeStaff({ archived: true }))).toBeNull();
  });
});
