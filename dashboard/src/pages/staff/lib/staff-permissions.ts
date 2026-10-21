// Who may do what on Staff (TutorLink#190, #173). Presentation only: the
// API refuses these writes whatever the page offers. Admins (and
// Developers) manage Staff; Managers only view, apart from a Tutor's or
// Manager's assigned Children. An Admin can't change another Admin's
// account (only invite them while they have no password), and can't
// archive themselves or change their own role.
import type { Role } from "@/lib/auth/auth";
import type { StaffRead } from "@/lib/queries/staff";

export type StaffPermissions = {
  canEdit: boolean;
  canChangeRole: boolean;
  // Archive on live Staff, Restore on archived Staff.
  canArchive: boolean;
  canInvite: boolean;
  canResetPassword: boolean;
  canEditTeaching: boolean;
  canAddTimeOff: boolean;
  canDecideTimeOff: boolean;
  canEditChildren: boolean;
  // Why account acts are off, shown beside them.
  lockReason: string | null;
};

const PEER_ADMIN_LOCK = "Only a developer can change another Admin’s account.";
const SELF_LOCK = "You can’t archive yourself.";

function getLockReason(isPeerAdmin: boolean, isSelfAdmin: boolean): string | null {
  if (isPeerAdmin) return PEER_ADMIN_LOCK;
  return isSelfAdmin ? SELF_LOCK : null;
}

export function getStaffPermissions(
  viewerRole: Role,
  viewerId: string,
  staff: StaffRead,
): StaffPermissions {
  const isAdmin = viewerRole === "admin" || viewerRole === "developer";
  const isOffice = isAdmin || viewerRole === "manager";
  const isSelf = staff.id === viewerId;
  // Only a Developer may change an Admin's account, so the lock is an Admin's alone.
  const isPeerAdmin = viewerRole === "admin" && staff.role === "admin" && !isSelf;
  const isLive = !staff.archived;
  const hasTeachingProfile = staff.tutor_id !== null;
  const canWriteAccount = isAdmin && isLive && !isPeerAdmin;

  return {
    canEdit: canWriteAccount,
    // Tutor ↔ Manager only; an Admin in or out means archive and add.
    canChangeRole: canWriteAccount && !isSelf && staff.role !== "admin",
    canArchive: isAdmin && !isPeerAdmin && !isSelf,
    canInvite: isAdmin && isLive && staff.sign_in_state !== "active",
    canResetPassword: canWriteAccount && staff.sign_in_state === "active",
    canEditTeaching: isAdmin && isLive && hasTeachingProfile,
    canAddTimeOff: isAdmin && isLive,
    canDecideTimeOff: isAdmin,
    // Only Tutors and Managers can be Assigned Tutors (TutorLink#242).
    canEditChildren:
      isOffice && isLive && hasTeachingProfile && staff.role !== "admin",
    lockReason: getLockReason(isPeerAdmin, isAdmin && isSelf),
  };
}
