// The request a To do row opens: who, when, why, and the Bookings it
// clashes with, with Approve / Decline in the footer. A slide-over on
// desktop, a page pushed in from the right on phone (kit fork A).
import type { ReactNode } from "react";
import { CalendarDays, CalendarX2, Check, Clock, MessageSquareText, X } from "lucide-react";
import { Avatar, TimeOffBadge } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { DetailRow } from "@/components/kit/components/detail";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { pluralize } from "@/components/kit/format";
import { cn, CARD_TITLE } from "@/components/kit/tokens";
import {
  formatClock,
  formatDate,
  formatTimeOffDates,
  ROLE_LABEL,
} from "@/pages/prototype/home/lib/labels";
import type { TodoActions } from "@/pages/prototype/home/hooks/use-todo-actions";
import type { ExceptionRead } from "@/pages/prototype/home/types/api";

type TimeOffDetailProps = {
  item: ExceptionRead | null;
  backLabel: string;
  actions: TodoActions;
  onClose: () => void;
};

export default function TimeOffDetail({
  item,
  backLabel,
  actions,
  onClose,
}: TimeOffDetailProps): ReactNode {
  const isBusy = item !== null && actions.busyId === item.id;
  // Decline's confirm opens over the details; they stay put if the
  // confirm is backed out of, and close once the decline lands.
  const isDeclining = isBusy && actions.declineTarget !== null;

  function handleApprove(): void {
    if (!item) return;
    actions.approve(item, onClose);
  }

  function handleDecline(): void {
    if (!item) return;
    actions.requestDecline(item, onClose);
  }

  return (
    <DetailOverlay
      isOpen={item !== null}
      onClose={onClose}
      title={item ? `Time off for ${item.staff.name}` : "Time off"}
      backLabel={backLabel}
      phoneMode="page"
      header={
        item && (
          <div className="flex items-center gap-3">
            <Avatar name={item.staff.name} size="lg" />
            <div className="min-w-0">
              <h2 className="kit-display truncate text-[22px] leading-[30px] font-bold">
                {item.staff.name}
              </h2>
              <p className="text-[14px] text-(--tl-muted)">
                {ROLE_LABEL[item.staff.role]} · asks for time off
              </p>
            </div>
          </div>
        )
      }
      footer={
        <>
          <Button
            variant="primary"
            icon={Check}
            isLoading={isBusy && !isDeclining}
            disabled={isDeclining}
            onClick={handleApprove}
          >
            Approve
          </Button>
          <Button icon={X} disabled={isBusy} onClick={handleDecline}>
            Decline
          </Button>
        </>
      }
    >
      {item && (
        <div className="flex flex-col gap-5 pt-3">
          <div>
            <TimeOffBadge status="Pending" />
          </div>
          <DetailRow icon={CalendarDays} label="Dates">
            {formatTimeOffDates(item)}
          </DetailRow>
          <DetailRow icon={MessageSquareText} label="Reason">
            {item.reason ?? <span className="text-(--tl-muted)">No reason given</span>}
          </DetailRow>
          <DetailRow icon={Clock} label="Asked">
            {formatDate(item.created_at.slice(0, 10))}
          </DetailRow>
          <ClashList item={item} />
        </div>
      )}
    </DetailOverlay>
  );
}

type ClashListProps = { item: ExceptionRead };

function ClashList({ item }: ClashListProps): ReactNode {
  const count = item.clashing_bookings_count;
  return (
    <section
      className={cn(
        "rounded-[18px] p-4",
        count > 0 ? "bg-(--tl-warning-tint)" : "bg-(--tl-surface-sunk)",
      )}
    >
      <h3
        className={cn(
          CARD_TITLE,
          "flex items-center gap-2",
          count > 0 ? "text-(--tl-warning)" : "text-(--tl-muted)",
        )}
      >
        <CalendarX2 aria-hidden className="size-[18px]" />
        {count > 0
          ? `${pluralize(count, "Booking", "Bookings")} in these dates`
          : "No Bookings in these dates"}
      </h3>
      {count > 0 && (
        <>
          <ul className="mt-2 flex flex-col gap-1.5 text-[14px] leading-5">
            {item.clashing_bookings.map((booking) => (
              <li key={booking.booking_id} className="tabular-nums">
                <span className="font-semibold">{booking.child_name}</span> ·{" "}
                {formatDate(booking.date)}, {formatClock(booking.start_time)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] leading-[18px] text-(--tl-ink-soft)">
            Approving puts them in To do › Bookings, to change or keep.
          </p>
        </>
      )}
    </section>
  );
}
