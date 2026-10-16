// Who may do what on Staff (TutorLink#190, #173). Admins manage Staff;
// Managers only view. An Admin can't change another Admin's account
// (only invite them while they have no password), and can't archive
// themselves or change their own role.
import type { StaffRead } from "@/pages/prototype/accounts-staff/types/api";
import type { OfficeRole } from "@/pages/prototype/accounts-staff/types/screens";

export type StaffPermissions = {
  canEdit: boolean;
  canChangeRole: boolean;
  canArchive: boolean;
  canInvite: boolean;
  canResetPassword: boolean;
  canEditTeaching: boolean;
  canAddTimeOff: boolean;
  canDecideTimeOff: boolean;
  // Why account acts are off, shown beside them.
  lockReason: string | null;
};

const PEER_ADMIN_LOCK = "Only a developer can change another Admin’s account.";
const SELF_ARCHIVE_LOCK = "You can’t archive yourself.";

export function getStaffPermissions(
  viewerRole: OfficeRole,
  viewerId: string,
  staff: StaffRead,
): StaffPermissions {
  const isAdmin = viewerRole === "admin";
  const isSelf = staff.id === viewerId;
  const isPeerAdmin = isAdmin && staff.role === "admin" && !isSelf;
  const isLive = !staff.archived;
  const canWriteAccount = isAdmin && !isPeerAdmin && isLive;

  return {
    canEdit: canWriteAccount,
    // Tutor ↔ Manager only; Admin in or out means archive and add.
    canChangeRole: canWriteAccount && staff.role !== "admin" && !isSelf,
    canArchive: isAdmin && !isPeerAdmin && !isSelf,
    canInvite: isAdmin && isLive && staff.sign_in_state !== "active",
    canResetPassword: canWriteAccount && staff.sign_in_state === "active",
    canEditTeaching: isAdmin && isLive && staff.tutor_id !== null,
    canAddTimeOff: isAdmin && isLive,
    canDecideTimeOff: isAdmin,
    lockReason: isPeerAdmin ? PEER_ADMIN_LOCK : isSelf && isAdmin ? SELF_ARCHIVE_LOCK : null,
  };
}
