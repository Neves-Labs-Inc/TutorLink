// Archive a Staff member. With upcoming Bookings the confirm names how
// many; nothing is cancelled, they wait in To do › Bookings for Change
// booking (POST /api/archive with confirm_warnings).
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import { getUpcomingBookings } from "@/pages/prototype/accounts-staff/lib/mock-api";
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

  function handleConfirm(): void {
    onClose();
    setStaffArchived(staff.id, true);
    showToast({
      tone: "success",
      message:
        count > 0
          ? `${staff.name} archived. ${bookings} wait in To do › Bookings.`
          : `${staff.name} archived.`,
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
      They can’t sign in or be booked any more. Restore brings them back.
    </ConfirmDialog>
  );
}
