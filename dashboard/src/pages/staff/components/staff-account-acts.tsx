// The Admin's account acts on Staff details: Edit and ⋯ in the header,
// and the sheets and confirm they open. Managers get none of it.
import type { ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  KeyRound,
  Mail,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { Button, IconButton } from "@/components/kit/components/button";
import { ActionsSheet } from "@/components/kit/overlays/actions-sheet";
import type { SheetAction } from "@/components/kit/overlays/actions-sheet";
import type { StaffRead } from "@/lib/queries/staff";
import ArchiveStaffDialog from "@/pages/staff/components/archive-staff-dialog";
import EditStaffSheet from "@/pages/staff/components/edit-staff-sheet";
import SubjectsSheet from "@/pages/staff/components/subjects-sheet";
import type { StaffAccountActs } from "@/pages/staff/hooks/use-staff-account-acts";
import type { StaffPermissions } from "@/pages/staff/lib/staff-permissions";

// The ⋯ rows this person's state offers. A locked row stays, saying why.
function getStaffMenuActions(
  staff: StaffRead,
  can: StaffPermissions,
  acts: StaffAccountActs,
): SheetAction[] {
  const lockReason = can.lockReason ?? undefined;
  const invite: SheetAction[] = can.canInvite
    ? [
        {
          id: "invite",
          label:
            staff.sign_in_state === "invited"
              ? "Send invite again"
              : "Send invite",
          icon: Mail,
          description: `To ${staff.email}`,
          onSelect: acts.invite,
        },
      ]
    : [];
  const reset: SheetAction[] =
    staff.sign_in_state === "active" && !staff.archived
      ? [
          {
            id: "reset",
            label: "Send password reset",
            icon: KeyRound,
            description: `To ${staff.email}`,
            disabledReason: can.canResetPassword ? undefined : lockReason,
            onSelect: acts.resetPassword,
          },
        ]
      : [];
  const archiveOrRestore: SheetAction = staff.archived
    ? {
        id: "restore",
        label: "Restore",
        icon: ArchiveRestore,
        description: "They sign in as before",
        disabledReason: can.canArchive ? undefined : lockReason,
        onSelect: acts.restore,
      }
    : {
        id: "archive",
        label: "Archive",
        icon: Archive,
        description: "They can’t sign in or be booked",
        isDanger: true,
        disabledReason: can.canArchive ? undefined : lockReason,
        onSelect: acts.archive.askToArchive,
      };
  return [...invite, ...reset, archiveOrRestore];
}

type StaffHeaderActionsProps = {
  can: StaffPermissions;
  acts: StaffAccountActs;
};

export function StaffHeaderActions({
  can,
  acts,
}: StaffHeaderActionsProps): ReactNode {
  return (
    <>
      <Button icon={Pencil} onClick={acts.edit.open} disabled={!can.canEdit}>
        Edit
      </Button>
      <IconButton
        icon={MoreHorizontal}
        label="More actions"
        onClick={acts.menu.open}
      />
    </>
  );
}

type StaffAccountOverlaysProps = {
  staff: StaffRead;
  can: StaffPermissions;
  acts: StaffAccountActs;
};

export function StaffAccountOverlays({
  staff,
  can,
  acts,
}: StaffAccountOverlaysProps): ReactNode {
  return (
    <>
      <ActionsSheet
        isOpen={acts.menu.isOpen}
        title={staff.name}
        actions={getStaffMenuActions(staff, can, acts)}
        onClose={acts.menu.close}
      />
      <EditStaffSheet
        key={`edit-${acts.edit.key}`}
        isOpen={acts.edit.isOpen}
        staff={staff}
        canChangeRole={can.canChangeRole}
        onClose={acts.edit.close}
      />
      {staff.tutor_id !== null && (
        <SubjectsSheet
          key={`subjects-${acts.subjects.key}`}
          isOpen={acts.subjects.isOpen}
          staff={staff}
          onClose={acts.subjects.close}
        />
      )}
      <ArchiveStaffDialog staff={staff} archive={acts.archive} />
    </>
  );
}
