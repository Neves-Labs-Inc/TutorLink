// One Time off's details, opened from the Staff Time off tab. Admins
// decide here (Approve / Decline, PATCH /api/exceptions/{id}) and cancel
// (POST .../cancel). Approving never cancels clashing Bookings: they go
// to To do › Bookings. Managers only read.
import type { ReactNode } from "react";
import { CalendarX2, TriangleAlert } from "lucide-react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import TimeOffStatusBadge from "@/pages/prototype/accounts-staff/components/time-off-status-badge";
import { useArea } from "@/pages/prototype/accounts-staff/hooks/use-area-store";
import {
  formatShortDate,
  formatTimeOffWindow,
  formatWeekdayDate,
  formatWireTime,
} from "@/pages/prototype/accounts-staff/lib/labels";
import { isTimeOffUpcoming } from "@/pages/prototype/accounts-staff/lib/mock-api";
import type { ExceptionRead } from "@/pages/prototype/accounts-staff/types/api";

type TimeOffSheetProps = {
  item: ExceptionRead;
  canDecide: boolean;
  onClose: () => void;
};

export default function TimeOffSheet({ item, canDecide, onClose }: TimeOffSheetProps): ReactNode {
  const { decideTimeOff, cancelTimeOff } = useArea();
  const { showToast } = useToast();
  const isLive = isTimeOffUpcoming(item);
  const canApprove = canDecide && isLive && (item.status === "pending" || item.status === "rejected");
  const canDecline = canDecide && isLive && item.status === "pending";
  const canCancel = canDecide && isLive && (item.status === "pending" || item.status === "approved");
  const clashes = item.clashing_bookings_count;

  function decide(status: "approved" | "rejected"): void {
    decideTimeOff(item.id, status);
    onClose();
    showToast({
      tone: "success",
      message:
        status === "approved"
          ? clashes > 0
            ? `Approved. ${clashes} clashing ${clashes === 1 ? "Booking is" : "Bookings are"} in To do › Bookings.`
            : "Time off approved."
          : "Time off declined.",
    });
  }

  let decision = `Requested ${formatShortDate(item.created_at)}`;
  if (item.decided_by && item.decided_at) {
    decision += ` · ${item.status === "rejected" ? "Declined" : "Approved"} by ${item.decided_by.name}, ${formatShortDate(item.decided_at)}`;
  }
  if (item.cancelled_by && item.cancelled_at) {
    decision += ` · Cancelled by ${item.cancelled_by.name}, ${formatShortDate(item.cancelled_at)}`;
  }

  return (
    <BottomSheet
      isOpen
      onClose={onClose}
      title={`Time off: ${item.staff.name}`}
      description={formatTimeOffWindow(item)}
      footer={
        canApprove || canDecline || canCancel ? (
          <>
            {canCancel && (
              <Button variant="danger-outline" icon={CalendarX2} onClick={() => { cancelTimeOff(item.id); onClose(); showToast({ tone: "success", message: "Time off cancelled." }); }}>
                Cancel time off
              </Button>
            )}
            {canDecline && <Button onClick={() => decide("rejected")}>Decline</Button>}
            {canApprove && <Button variant="primary" onClick={() => decide("approved")}>Approve</Button>}
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <TimeOffStatusBadge item={item} />
        </div>
        <p className="text-[15px]">{item.reason ?? <span className="text-(--tl-muted)">No reason given</span>}</p>
        <p className="text-[13px] text-(--tl-muted)">{decision}</p>
        {clashes > 0 && (
          <div className="rounded-[16px] bg-(--tl-warning-tint) px-4 py-3 text-(--tl-warning)">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <TriangleAlert aria-hidden className="size-4" />
              {clashes} {clashes === 1 ? "Booking clashes" : "Bookings clash"}
            </p>
            <ul className="mt-1 text-[13px] leading-5">
              {item.clashing_bookings.map((booking) => (
                <li key={booking.booking_id}>
                  {formatWeekdayDate(booking.date)}, {formatWireTime(booking.start_time)} · {booking.child_name}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[13px]">Approving keeps them. They go to To do › Bookings to sort out.</p>
          </div>
        )}
        {!canDecide && item.status === "pending" && (
          <p className="text-[13px] text-(--tl-muted)">Waiting for an Admin to decide.</p>
        )}
      </div>
    </BottomSheet>
  );
}
