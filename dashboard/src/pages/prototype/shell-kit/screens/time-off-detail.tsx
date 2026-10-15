// One time-off request in the DetailOverlay. Admins decide a pending one
// from the footer; everyone else just reads it.
import type { ReactNode } from "react";
import { CalendarDays, Check, NotebookPen, UserRound, X } from "lucide-react";
import type { TimeOff, TimeOffStatus } from "@/pages/prototype/shell-kit/kit/mock-data";
import { Avatar, TimeOffBadge } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";

type TimeOffDetailProps = {
  item: TimeOff | null;
  backLabel: string;
  onClose: () => void;
  onDecide?: (item: TimeOff, status: TimeOffStatus) => void;
};

export default function TimeOffDetail({
  item,
  backLabel,
  onClose,
  onDecide,
}: TimeOffDetailProps): ReactNode {
  if (!item) return null;
  const canDecide = Boolean(onDecide) && item.status === "Pending";

  function decide(status: TimeOffStatus): void {
    if (!item) return;
    onDecide?.(item, status);
    onClose();
  }

  return (
    <DetailOverlay
      isOpen
      onClose={onClose}
      title={`Time off: ${item.staff}`}
      backLabel={backLabel}
      phoneMode="page"
      header={<TimeOffBadge status={item.status} />}
      footer={
        canDecide ? (
          <>
            <Button
              variant="soft"
              icon={Check}
              isFullWidth
              className="@md:flex-1"
              onClick={() => decide("Approved")}
            >
              Approve
            </Button>
            <Button icon={X} isFullWidth className="@md:flex-1" onClick={() => decide("Declined")}>
              Decline
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex items-center gap-4">
        <Avatar name={item.staff} size="lg" />
        <div className="min-w-0">
          <h2 className="kit-display truncate text-[28px] leading-9 font-light">
            {item.staff}
          </h2>
          <p className="text-[14px] text-(--tl-muted)">{item.staffRole}</p>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-5">
        <DetailRow icon={CalendarDays} label="When">
          <p className="font-semibold tabular-nums">{item.range}</p>
        </DetailRow>
        <DetailRow icon={NotebookPen} label="Reason">
          <p className="font-semibold">{item.reason}</p>
        </DetailRow>
        <DetailRow icon={UserRound} label="Who decides">
          <p>
            {item.staffRole === "Admin"
              ? "No one: an Admin’s time off takes effect straight away."
              : "An Admin approves or declines."}
          </p>
        </DetailRow>
      </div>
    </DetailOverlay>
  );
}
