// Asks before cancelling Time off. The owner hears they can be booked
// again and how to change dates; anyone else hears it about the person.
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import type { ExceptionRead } from "@/lib/queries/time-off";
import {
  formatTimeOffDates,
  getFirstName,
} from "@/pages/time-off/lib/time-off-copy";

type TimeOffCancelDialogProps = {
  item: ExceptionRead;
  isOwn: boolean;
  isOpen: boolean;
  isWorking: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

export default function TimeOffCancelDialog({
  item,
  isOwn,
  isOpen,
  isWorking,
  onClose,
  onConfirm,
}: TimeOffCancelDialogProps): ReactNode {
  const isRequest = isOwn && item.status === "pending";
  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={isRequest ? "Cancel this request?" : "Cancel this time off?"}
      confirmLabel={isRequest ? "Cancel request" : "Cancel time off"}
      keepLabel="Keep it"
      isDestructive
      isWorking={isWorking}
    >
      <span className="font-semibold">{formatTimeOffDates(item)}</span>.{" "}
      {isOwn
        ? "You can be booked in these times again. To change the dates, cancel and request again."
        : `${getFirstName(item.staff.name)} can be booked in these times again.`}
    </ConfirmDialog>
  );
}
