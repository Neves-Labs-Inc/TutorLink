// The setup checklist on new Staff details (TutorLink#190): Subjects,
// Availability and Invite for a Tutor or Manager who teaches, Invite
// alone for everyone else. Admins only, live Staff only, and gone once
// every step is done.
import { pluralize } from "@/components/kit/format";
import type { Role } from "@/lib/auth/auth";
import type { StaffRead } from "@/lib/queries/staff";
import type { StaffPermissions } from "@/pages/staff/lib/staff-permissions";

// Active Availability slots, or where their read stands.
export type SlotCount = number | "loading" | "failed";

export type SetupStepId = "subjects" | "availability" | "invite";

export type SetupStep = {
  id: SetupStepId;
  label: string;
  // Null while it is still loading.
  detail: string | null;
  isDone: boolean;
  // Only when the viewer may act and the step isn't done.
  actLabel: string | null;
};

export type SetupChecklist = { steps: SetupStep[]; doneCount: number };

function getActLabel(
  isDone: boolean,
  isAllowed: boolean,
  label: string,
): string | null {
  return !isDone && isAllowed ? label : null;
}

function getSubjectsStep(staff: StaffRead, can: StaffPermissions): SetupStep {
  const isDone = staff.subjects.length > 0;
  return {
    id: "subjects",
    label: "Subjects",
    detail: isDone
      ? staff.subjects.map((subject) => subject.name).join(", ")
      : "What they teach, and up to which grade",
    isDone,
    actLabel: getActLabel(isDone, can.canEditTeaching, "Add subjects"),
  };
}

function getAvailabilityDetail(slotCount: SlotCount): string | null {
  if (slotCount === "loading") return null;
  return slotCount === "failed" || slotCount === 0
    ? "When Guardians can book them"
    : `${pluralize(slotCount, "time range", "time ranges")} a week`;
}

function getAvailabilityStep(
  slotCount: SlotCount,
  can: StaffPermissions,
): SetupStep {
  const isDone = typeof slotCount === "number" && slotCount > 0;
  // No act until the count says whether it's needed.
  const isActShown = can.canEditTeaching && slotCount !== "loading";
  return {
    id: "availability",
    label: "Availability",
    detail: getAvailabilityDetail(slotCount),
    isDone,
    actLabel: getActLabel(isDone, isActShown, "Set availability"),
  };
}

function getInviteStep(staff: StaffRead, can: StaffPermissions): SetupStep {
  const isDone = staff.sign_in_state !== "not_invited";
  return {
    id: "invite",
    label: "Invite",
    detail: isDone
      ? "Sent. They sign in once they choose a password."
      : `An email to ${staff.email} to choose a password`,
    isDone,
    actLabel: getActLabel(isDone, can.canInvite, "Send invite"),
  };
}

export function getSetupChecklist(
  staff: StaffRead,
  viewerRole: Role,
  can: StaffPermissions,
  slotCount: SlotCount,
): SetupChecklist | null {
  const isAdminViewer = viewerRole === "admin" || viewerRole === "developer";
  if (!isAdminViewer || staff.archived) return null;

  const isTeacher = staff.tutor_id !== null && staff.role !== "admin";
  const teachingSteps = isTeacher
    ? [getSubjectsStep(staff, can), getAvailabilityStep(slotCount, can)]
    : [];
  const steps = [...teachingSteps, getInviteStep(staff, can)];
  const doneCount = steps.filter((step) => step.isDone).length;
  return doneCount === steps.length ? null : { steps, doneCount };
}
