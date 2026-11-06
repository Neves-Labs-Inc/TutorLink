// The Admin's writes on one Staff member's account, shared by the
// header (Edit, ⋯), Overview (Edit subjects) and the setup checklist:
// which sheet is open, and the one-tap acts (Invite, password reset,
// Restore), each answered by a toast.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import {
  refreshStaff,
  restoreStaff,
  sendStaffInvite,
  sendStaffPasswordReset,
} from "@/lib/queries/staff";
import type { StaffRead } from "@/lib/queries/staff";
import { useStaffArchive } from "@/pages/staff/hooks/use-staff-archive";
import type { StaffArchive } from "@/pages/staff/hooks/use-staff-archive";

// A sheet that remounts on every open (its key), so it starts from the saved row.
export type SheetState = {
  isOpen: boolean;
  key: number;
  open: () => void;
  close: () => void;
};

export type StaffAccountActs = {
  menu: SheetState;
  edit: SheetState;
  subjects: SheetState;
  archive: StaffArchive;
  isInviting: boolean;
  invite: () => void;
  resetPassword: () => void;
  restore: () => void;
};

// Closes when the member Staff details is open on changes (or goes away):
// a sheet belongs to the member it was opened for.
function useSheetState(openStaffId: string | undefined): SheetState {
  const [isOpen, setIsOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [seenStaffId, setSeenStaffId] = useState(openStaffId);
  if (seenStaffId !== openStaffId) {
    setSeenStaffId(openStaffId);
    setIsOpen(false);
  }
  return {
    isOpen,
    key,
    open: () => {
      setKey((current) => current + 1);
      setIsOpen(true);
    },
    close: () => setIsOpen(false),
  };
}

// Takes the row once loaded; until then nothing can call it. `openStaffId` is
// the member the route has open: `staff` can outlive it while details animate out.
export function useStaffAccountActs(
  staff: StaffRead | undefined,
  openStaffId: string | undefined,
): StaffAccountActs {
  const client = useQueryClient();
  const { showToast } = useToast();
  const menu = useSheetState(openStaffId);
  const edit = useSheetState(openStaffId);
  const subjects = useSheetState(openStaffId);
  const archive = useStaffArchive(staff, openStaffId);
  const onSuccess = () => refreshStaff(client);
  const invite = useMutation({ mutationFn: sendStaffInvite, onSuccess });
  const reset = useMutation({ mutationFn: sendStaffPasswordReset, onSuccess });
  const restore = useMutation({ mutationFn: restoreStaff, onSuccess });
  const staffId = staff?.id ?? "";
  const name = staff?.name ?? "";
  const email = staff?.email ?? "";

  return {
    menu,
    edit,
    subjects,
    archive,
    isInviting: invite.isPending,
    invite: () =>
      invite.mutate(staffId, {
        onSuccess: () =>
          showToast({
            tone: "success",
            message: `Invite sent to ${email}. It lasts 7 days.`,
          }),
        onError: () =>
          showToast({
            tone: "error",
            message: "Couldn’t send the Invite. Try again.",
          }),
      }),
    resetPassword: () =>
      reset.mutate(staffId, {
        onSuccess: () =>
          showToast({
            tone: "success",
            message: `Password reset sent to ${email}.`,
          }),
        onError: () =>
          showToast({
            tone: "error",
            message: "Couldn’t send the reset email. Try again.",
          }),
      }),
    restore: () =>
      restore.mutate(staffId, {
        onSuccess: () =>
          showToast({ tone: "success", message: `${name} restored.` }),
        onError: () =>
          showToast({
            tone: "error",
            message: "Couldn’t restore them. Try again.",
          }),
      }),
  };
}
