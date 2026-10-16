// Decline is a confirm with no note (TutorLink#189); the buttons name
// the act, so "cancel" never means two things.
import type { ReactNode } from "react";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { formatTimeOffDates } from "@/pages/prototype/home/lib/labels";
import type { TodoActions } from "@/pages/prototype/home/hooks/use-todo-actions";

type DeclineDialogProps = { actions: TodoActions };

export default function DeclineDialog({ actions }: DeclineDialogProps): ReactNode {
  const target = actions.declineTarget;
  return (
    <ConfirmDialog
      isOpen={target !== null}
      onClose={actions.cancelDecline}
      onConfirm={actions.confirmDecline}
      title="Decline this time off?"
      confirmLabel="Decline time off"
      keepLabel="Keep it pending"
      isWorking={target !== null && actions.busyId === target.id}
    >
      {target && (
        <>
          <span className="font-semibold">{target.staff.name}</span>,{" "}
          {formatTimeOffDates(target)}. They’ll see it as Declined and their
          Bookings stay as they are.
        </>
      )}
    </ConfirmDialog>
  );
}
