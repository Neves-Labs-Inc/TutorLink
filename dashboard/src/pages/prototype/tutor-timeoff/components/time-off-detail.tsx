// One Time off in the details panel: the only place its actions live
// (Franklin's review). An Admin approves or declines a pending request,
// approves a declined one while it hasn't ended, and cancels pending or
// approved time off. The owner cancels their own. Everyone else reads.
import { useState } from "react";
import type { ReactNode } from "react";
import { CalendarDays, CalendarX2, Check, Clock, MessageSquareText, X } from "lucide-react";
import { Avatar } from "@/pages/prototype/shell-kit/kit/components/badges";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { DetailRow } from "@/pages/prototype/shell-kit/kit/components/detail";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { ConfirmDialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { pluralize } from "@/pages/prototype/shell-kit/kit/format";
import { CARD_TITLE, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import OpenQuestion from "@/pages/prototype/tutor-timeoff/components/open-question";
import { TimeOffStatusBadge } from "@/pages/prototype/tutor-timeoff/components/time-off-status";
import { getStatusSentence } from "@/pages/prototype/tutor-timeoff/lib/status-copy";
import {
  formatClock,
  formatDate,
  formatLength,
  formatStamp,
  formatTimeOffDates,
  getFirstName,
  ROLE_LABEL,
} from "@/pages/prototype/tutor-timeoff/lib/labels";
import { canApprove, canCancel, canDecline } from "@/pages/prototype/tutor-timeoff/lib/rules";
import type { AreaStore } from "@/pages/prototype/tutor-timeoff/hooks/use-area-store";
import type { ExceptionRead } from "@/pages/prototype/tutor-timeoff/types/api";

type Confirming = "decline" | "cancel" | null;
type Busy = "approve" | "decline" | "cancel" | null;

type TimeOffDetailProps = {
  item: ExceptionRead | null;
  store: AreaStore;
  backLabel: string;
  onClose: () => void;
};

export default function TimeOffDetail({
  item,
  store,
  backLabel,
  onClose,
}: TimeOffDetailProps): ReactNode {
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const { showToast } = useToast();
  if (!item) return null;

  const me = store.me;
  const isAdmin = me.role === "admin";
  const isOwn = item.staff.id === me.id;
  const who = isOwn ? "your" : `${getFirstName(item.staff.name)}’s`;
  const canAct = isAdmin || isOwn;
  const isDeclined = item.status === "rejected";

  async function handleApprove(): Promise<void> {
    if (!item) return;
    setBusy("approve");
    // The clashes are listed right here, so Approve confirms them in
    // one tap (#189) by sending booking_clash with the decision.
    const result = await store.decide(item.id, "approved", true);
    setBusy(null);
    showToast(
      result.value
        ? { tone: "success", message: `Approved ${who} time off.` }
        : { tone: "error", message: result.error ?? "Couldn’t approve. Try again." },
    );
  }

  async function handleConfirm(): Promise<void> {
    if (!item || !confirming) return;
    setBusy(confirming);
    const result =
      confirming === "decline"
        ? await store.decide(item.id, "rejected", false)
        : await store.cancel(item.id);
    setBusy(null);
    setConfirming(null);
    const done = confirming === "decline" ? "Declined" : "Cancelled";
    showToast(
      result.value
        ? { tone: "success", message: `${done} ${who} time off.` }
        : { tone: "error", message: result.error ?? "Couldn’t save. Try again." },
    );
  }

  const approveButton = (
    <Button
      variant="primary"
      icon={Check}
      isLoading={busy === "approve"}
      disabled={busy !== null && busy !== "approve"}
      onClick={handleApprove}
      className="@md:flex-1"
    >
      Approve
    </Button>
  );
  const actions: ReactNode[] = [];
  if (isAdmin && canApprove(item)) {
    actions.push(
      isDeclined ? (
        <span key="approve" className="flex items-center gap-2 pr-2 @md:flex-1 [&>button]:flex-1">
          {approveButton}
          <OpenQuestion question="CONTEXT.md lets an Admin still approve a declined request. Is it worth a button here, or should they ask the person to request again?" />
        </span>
      ) : (
        <span key="approve" className="contents">
          {approveButton}
        </span>
      ),
    );
  }
  if (isAdmin && canDecline(item)) {
    actions.push(
      <Button key="decline" icon={X} disabled={busy !== null} onClick={() => setConfirming("decline")} className="@md:flex-1">
        Decline
      </Button>,
    );
  }
  // An Admin cancels approved time off, or their own; a pending request
  // from someone else is theirs to decide, not cancel.
  if (canAct && canCancel(item) && (isOwn || item.status === "approved")) {
    actions.push(
      <Button
        key="cancel"
        variant="danger-outline"
        disabled={busy !== null}
        onClick={() => setConfirming("cancel")}
        className="@md:flex-1"
      >
        {item.status === "pending" && isOwn ? "Cancel request" : "Cancel time off"}
      </Button>,
    );
  }

  return (
    <>
      <DetailOverlay
        isOpen
        onClose={onClose}
        title={`Time off for ${item.staff.name}`}
        backLabel={backLabel}
        phoneMode="page"
        header={<TimeOffStatusBadge status={item.status} />}
        footer={actions.length > 0 ? actions : undefined}
      >
        {!isOwn && (
          <div className="mb-4 flex items-center gap-3">
            <Avatar name={item.staff.name} />
            <p className="min-w-0 text-[15px] leading-6">
              <span className="font-semibold">{item.staff.name}</span>
              <span className="text-(--tl-muted)"> · {ROLE_LABEL[item.staff.role]}</span>
            </p>
          </div>
        )}
        <h2 className="kit-display text-[26px] leading-9 font-light">
          {formatTimeOffDates(item)}
        </h2>
        <p
          className={cn(
            "mt-4 rounded-[18px] px-4 py-3 text-[15px] leading-6",
            item.status === "approved" && "bg-(--tl-success-tint) text-(--tl-success)",
            item.status === "pending" && "bg-(--tl-warning-tint) text-(--tl-warning)",
            item.status === "rejected" && "bg-(--tl-danger-tint) text-(--tl-danger)",
            (item.status === "cancelled" || item.status === "expired") &&
              "bg-(--tl-neutral-tint) text-(--tl-neutral)",
          )}
        >
          {getStatusSentence(item, me.id)}
        </p>
        <div className="mt-6 flex flex-col gap-5">
          <DetailRow icon={CalendarDays} label="How long">
            {formatLength(item)}
          </DetailRow>
          <DetailRow icon={MessageSquareText} label="Reason">
            {item.reason ?? <span className="text-(--tl-muted)">No reason given</span>}
          </DetailRow>
          <DetailRow icon={Clock} label={isOwn ? "You asked" : "Asked"}>
            {formatStamp(item.created_at)}
          </DetailRow>
          {(item.status === "pending" || item.status === "approved") && (
            <ClashList item={item} isOwn={isOwn} isAdmin={isAdmin} />
          )}
        </div>
      </DetailOverlay>
      <ConfirmDialog
        isOpen={confirming === "decline"}
        onClose={() => setConfirming(null)}
        onConfirm={handleConfirm}
        title="Decline this time off?"
        confirmLabel="Decline time off"
        keepLabel="Keep it pending"
        isWorking={busy === "decline"}
      >
        <span className="font-semibold">{item.staff.name}</span>, {formatTimeOffDates(item)}.
        They’ll see it as Declined and can still be booked.
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={confirming === "cancel"}
        onClose={() => setConfirming(null)}
        onConfirm={handleConfirm}
        title={item.status === "pending" && isOwn ? "Cancel this request?" : "Cancel this time off?"}
        confirmLabel={item.status === "pending" && isOwn ? "Cancel request" : "Cancel time off"}
        keepLabel="Keep it"
        isDestructive
        isWorking={busy === "cancel"}
      >
        {formatTimeOffDates(item)}.{" "}
        {isOwn
          ? "You can be booked in these times again. To change the dates, cancel and request again."
          : `${getFirstName(item.staff.name)} can be booked in these times again.`}
      </ConfirmDialog>
    </>
  );
}

type ClashListProps = { item: ExceptionRead; isOwn: boolean; isAdmin: boolean };

function ClashList({ item, isOwn, isAdmin }: ClashListProps): ReactNode {
  const count = item.clashing_bookings_count;
  const noun = isOwn && !isAdmin ? ["session", "sessions"] : ["Booking", "Bookings"];
  let note = "If it’s approved, the office will change or keep them.";
  if (isAdmin && item.status === "pending") {
    note = "Approving keeps them and puts them in To do › Bookings, to change or keep.";
  } else if (item.status === "approved") {
    note = "They wait in To do › Bookings for the office to change or keep.";
  }
  return (
    <section
      className={cn(
        "rounded-[18px] p-4",
        count > 0 ? "bg-(--tl-warning-tint) text-(--tl-warning)" : "bg-(--tl-surface-sunk) text-(--tl-muted)",
      )}
    >
      <h3 className={cn(CARD_TITLE, "flex items-center gap-2")}>
        <CalendarX2 aria-hidden className="size-[18px]" />
        {count > 0
          ? `${pluralize(count, noun[0], noun[1])} in these dates`
          : `No ${noun[1]} in these dates`}
      </h3>
      {count > 0 && (
        <>
          <ul className="mt-2 flex flex-col gap-1.5 text-[14px] leading-5 text-(--tl-ink)">
            {item.clashing_bookings.map((booking) => (
              <li key={booking.booking_id} className="tabular-nums">
                <span className="font-semibold">{booking.child_name}</span> ·{" "}
                {formatDate(booking.date)}, {formatClock(booking.start_time)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] leading-[18px]">{note}</p>
        </>
      )}
    </section>
  );
}
