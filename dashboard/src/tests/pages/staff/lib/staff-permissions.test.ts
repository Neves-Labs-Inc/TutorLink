import { describe, expect, it } from "vitest";
import type { SignInStateWire, StaffRead } from "@/lib/queries/staff";
import { getStaffPermissions } from "@/pages/staff/lib/staff-permissions";
import type { StaffPermissions } from "@/pages/staff/lib/staff-permissions";

const VIEWER_ID = "u-viewer";
const PEER_ADMIN_LOCK = "Only a developer can change another Admin’s account.";
const SELF_LOCK = "You can’t archive yourself.";

function makeStaff(overrides: Partial<StaffRead> = {}): StaffRead {
  return {
    id: "u-ana",
    name: "Ana Brooks",
    role: "tutor",
    tutor_id: "t-ana",
    email: "ana@example.com",
    sign_in_state: "active",
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

const TUTOR = makeStaff();
const MANAGER = makeStaff({ id: "u-dan", role: "manager", tutor_id: "t-dan" });
const ADMIN = makeStaff({ id: "u-rita", role: "admin", tutor_id: null });
const SELF = makeStaff({ id: VIEWER_ID, role: "admin", tutor_id: null });
const ARCHIVED_TUTOR = makeStaff({ archived: true });

const NOTHING: StaffPermissions = {
  canEdit: false,
  canChangeRole: false,
  canArchive: false,
  canInvite: false,
  canResetPassword: false,
  canEditTeaching: false,
  canAddTimeOff: false,
  canDecideTimeOff: false,
  canEditChildren: false,
  lockReason: null,
};

const FULL_ACCESS_TO_ACTIVE_TUTOR: StaffPermissions = {
  canEdit: true,
  canChangeRole: true,
  canArchive: true,
  canInvite: false,
  canResetPassword: true,
  canEditTeaching: true,
  canAddTimeOff: true,
  canDecideTimeOff: true,
  canEditChildren: true,
  lockReason: null,
};

describe.each(["admin", "developer"] as const)("%s viewer", (viewerRole) => {
  it("may do everything to an active Tutor except invite them", () => {
    expect(getStaffPermissions(viewerRole, VIEWER_ID, TUTOR)).toEqual(
      FULL_ACCESS_TO_ACTIVE_TUTOR,
    );
  });

  it("may do everything to an active Manager with a teaching profile", () => {
    expect(getStaffPermissions(viewerRole, VIEWER_ID, MANAGER)).toEqual(
      FULL_ACCESS_TO_ACTIVE_TUTOR,
    );
  });

  it.each<[SignInStateWire, boolean, boolean]>([
    ["not_invited", true, false],
    ["invited", true, false],
    ["active", false, true],
  ])(
    "for a %s Tutor: invite %s, password reset %s",
    (state, canInvite, canResetPassword) => {
      const can = getStaffPermissions(
        viewerRole,
        VIEWER_ID,
        makeStaff({ sign_in_state: state }),
      );
      expect(can.canInvite).toBe(canInvite);
      expect(can.canResetPassword).toBe(canResetPassword);
    },
  );

  it("on archived Staff may only Restore, never edit, invite or add", () => {
    const can = getStaffPermissions(
      viewerRole,
      VIEWER_ID,
      makeStaff({ archived: true, sign_in_state: "invited" }),
    );
    expect(can).toEqual({
      ...NOTHING,
      canArchive: true,
      canDecideTimeOff: true,
    });
  });

  it("can't change a teaching profile that doesn't exist", () => {
    const can = getStaffPermissions(
      viewerRole,
      VIEWER_ID,
      makeStaff({ role: "manager", tutor_id: null }),
    );
    expect(can.canEditTeaching).toBe(false);
    expect(can.canEditChildren).toBe(false);
  });

  it("never changes an Admin's role, only a Tutor's or Manager's", () => {
    expect(getStaffPermissions(viewerRole, VIEWER_ID, ADMIN).canChangeRole).toBe(
      false,
    );
  });
});

describe("admin viewing another Admin (peer)", () => {
  it.each<SignInStateWire>(["not_invited", "invited", "active"])(
    "locks edit, archive and reset for a %s peer, with the reason",
    (state) => {
      const can = getStaffPermissions(
        "admin",
        VIEWER_ID,
        makeStaff({ ...ADMIN, sign_in_state: state }),
      );
      expect(can.canEdit).toBe(false);
      expect(can.canArchive).toBe(false);
      expect(can.canResetPassword).toBe(false);
      expect(can.canChangeRole).toBe(false);
      expect(can.lockReason).toBe(PEER_ADMIN_LOCK);
    },
  );

  it.each<[SignInStateWire, boolean]>([
    ["not_invited", true],
    ["invited", true],
    ["active", false],
  ])("for a %s peer keeps invite: %s", (state, canInvite) => {
    const can = getStaffPermissions(
      "admin",
      VIEWER_ID,
      makeStaff({ ...ADMIN, sign_in_state: state }),
    );
    expect(can.canInvite).toBe(canInvite);
  });

  it("doesn't lock a Developer out of an Admin's account", () => {
    const can = getStaffPermissions("developer", VIEWER_ID, ADMIN);
    expect(can.canEdit).toBe(true);
    expect(can.canArchive).toBe(true);
    expect(can.canResetPassword).toBe(true);
    expect(can.lockReason).toBeNull();
  });

  it("locks Restore of an archived peer too", () => {
    const can = getStaffPermissions(
      "admin",
      VIEWER_ID,
      makeStaff({ ...ADMIN, archived: true }),
    );
    expect(can.canArchive).toBe(false);
    expect(can.lockReason).toBe(PEER_ADMIN_LOCK);
  });
});

describe("admin viewing themselves", () => {
  it("can edit and reset but not archive or change role, with the reason", () => {
    expect(getStaffPermissions("admin", VIEWER_ID, SELF)).toEqual({
      ...NOTHING,
      canEdit: true,
      canResetPassword: true,
      canAddTimeOff: true,
      canDecideTimeOff: true,
      lockReason: SELF_LOCK,
    });
  });
});

describe("manager viewer", () => {
  it.each([
    ["an active Tutor", TUTOR],
    ["a Manager", MANAGER],
  ])("may only change the Children of %s", (_, staff) => {
    expect(getStaffPermissions("manager", VIEWER_ID, staff)).toEqual({
      ...NOTHING,
      canEditChildren: true,
    });
  });

  it.each<SignInStateWire>(["not_invited", "invited", "active"])(
    "can't invite or reset a %s Tutor",
    (state) => {
      const can = getStaffPermissions(
        "manager",
        VIEWER_ID,
        makeStaff({ sign_in_state: state }),
      );
      expect(can.canInvite).toBe(false);
      expect(can.canResetPassword).toBe(false);
    },
  );

  it.each<[string, StaffRead, boolean]>([
    ["an Admin", ADMIN, false],
    ["archived Staff", ARCHIVED_TUTOR, false],
    ["themselves", makeStaff({ id: VIEWER_ID, role: "manager" }), true],
  ])(
    "may change nothing on %s but live Children (%s)",
    (_, staff, canEditChildren) => {
      expect(getStaffPermissions("manager", VIEWER_ID, staff)).toEqual({
        ...NOTHING,
        canEditChildren,
      });
    },
  );
});

describe("tutor viewer", () => {
  it("may change nothing", () => {
    expect(getStaffPermissions("tutor", VIEWER_ID, TUTOR)).toEqual(NOTHING);
  });
});
