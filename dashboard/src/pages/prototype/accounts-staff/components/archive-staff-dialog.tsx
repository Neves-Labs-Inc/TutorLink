// Archive a Staff member. With upcoming Bookings the confirm names how
// many; nothing is cancelled, they wait in To do › Bookings for Change
// booking (POST /api/archive with confirm_warnings).
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  getUpcomingBookings,
  listAssignedChildren,
} from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { StaffRead } from "@/pages/prototype/accounts-staff/types/api";

type ArchiveStaffDialogProps = {
  staff: StaffRead;
  isOpen: boolean;
  onClose: () => void;
};

export default function ArchiveStaffDialog({
  staff,
  isOpen,
  onClose,
}: ArchiveStaffDialogProps): ReactNode {
  const { db, setStaffArchived } = useArea();
  const { showToast } = useToast();
  const count = getUpcomingBookings(db, (b) => b.staff.id === staff.id).length;
  const bookings = `${count} upcoming ${count === 1 ? "Booking" : "Bookings"}`;
  // Archiving removes their Assigned Tutor links (TutorLink#242); a Child
  // left with none needs a Tutor.
  const assigned = listAssignedChildren(db, staff.id).filter((child) => !child.archived);
  const leftEmpty = assigned.filter((child) => child.assigned_tutors.length === 1);
  const children = `${assigned.length} ${assigned.length === 1 ? "Child" : "Children"}`;

  function handleConfirm(): void {
    onClose();
    setStaffArchived(staff.id, true);
    const parts = [
      `${staff.name} archived.`,
      count > 0 ? `${bookings} wait in To do › Bookings.` : "",
      leftEmpty.length > 0 ? `${leftEmpty.map((child) => child.name).join(", ")} now ${leftEmpty.length === 1 ? "needs" : "need"} a Tutor.` : "",
    ];
    showToast({
      tone: "success",
      message: parts.filter(Boolean).join(" "),
      actionLabel: "Undo",
      onAction: () => setStaffArchived(staff.id, false),
    });
  }

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title={`Archive ${staff.name}?`}
      confirmLabel="Archive"
      keepLabel="Keep"
      isDestructive
    >
      {count > 0 ? (
        <>
          <strong>{bookings}</strong> are with them. Nothing is cancelled:
          they wait in To do › Bookings for you to Change booking.{" "}
        </>
      ) : null}
      {assigned.length > 0 ? (
        <>
          They stop being an Assigned Tutor of <strong>{children}</strong>
          {leftEmpty.length > 0 && `, leaving ${leftEmpty.map((child) => child.name).join(", ")} with none`}.
          Restore doesn’t bring that back.{" "}
        </>
      ) : null}
      They can’t sign in or be booked any more. Restore brings them back.
    </ConfirmDialog>
  );
}
