// One Time off in the details overlay: the only place its acts live.
// Approve and Decline lead the footer, Cancel follows. Keep it mounted:
// `id` null closes it.
import type { ReactNode, RefObject } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CircleAlert,
  Clock,
  MessageSquareText,
  SearchX,
  X,
} from "lucide-react";
import { Avatar, TimeOffBadge } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { DetailRow } from "@/components/kit/components/detail";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { EmptyState, ErrorState, Skeleton } from "@/components/kit/states/states";
import type { ExceptionRead } from "@/lib/queries/time-off";
import { roleLabel } from "@/lib/users/users";
import TimeOffCancelDialog from "@/pages/time-off/components/time-off-cancel-dialog";
import TimeOffClashBlock from "@/pages/time-off/components/time-off-clash-block";
import TimeOffDetailsSkeleton from "@/pages/time-off/components/time-off-details-skeleton";
import TimeOffStatusWell from "@/pages/time-off/components/time-off-status-well";
import { useTimeOffDecision } from "@/pages/time-off/hooks/use-time-off-decision";
import type { TimeOffDecisionActs } from "@/pages/time-off/hooks/use-time-off-decision";
import { useTimeOffDetails } from "@/pages/time-off/hooks/use-time-off-details";
import type { TimeOffDetails as Details } from "@/pages/time-off/hooks/use-time-off-details";
import {
  formatStamp,
  formatTimeOffDates,
  formatTimeOffLength,
} from "@/pages/time-off/lib/time-off-copy";
import {
  canApprove,
  canCancel,
  canDecline,
  getTimeOffBadgeStatus,
  isAdminViewer,
} from "@/pages/time-off/lib/time-off-rules";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";

type TimeOffDetailsProps = {
  id: string | null;
  viewer: Viewer;
  backLabel: string;
  onClose: () => void;
};

export default function TimeOffDetails({
  id,
  viewer,
  backLabel,
  onClose,
}: TimeOffDetailsProps): ReactNode {
  const details = useTimeOffDetails(id, viewer);
  const { read, wellRef } = details;
  const item = read.kind === "ready" ? read.item : null;
  const decision = useTimeOffDecision(item, viewer, wellRef);
  const isOwn = item?.staff.id === viewer.id;
  const acts = item && !decision.isQueued ? getActs(item, viewer) : NO_ACTS;
  const hasFooter =
    item !== null &&
    (acts.canApprove ||
      acts.canDecline ||
      acts.canCancel ||
      details.actError !== null);

  let header: ReactNode = null;
  let body: ReactNode = <TimeOffDetailsSkeleton />;
  if (read.kind === "loading") {
    header = <Skeleton className="h-7 w-24 rounded-full" />;
  } else if (read.kind === "not-found") {
    body = (
      <EmptyState
        isBare
        icon={SearchX}
        tone="primary"
        title="Couldn’t find this time off"
        body="It may have been removed, or it isn’t yours to see."
        action={
          <Button variant="outline" icon={ArrowLeft} onClick={onClose}>
            Back to {backLabel}
          </Button>
        }
      />
    );
  } else if (read.kind === "error") {
    body = (
      <ErrorState
        title="Couldn’t load this time off"
        body="Check your connection and try again."
        onRetry={read.onRetry}
        isRetrying={read.isRetrying}
      />
    );
  } else {
    header = <TimeOffBadge status={getTimeOffBadgeStatus(read.item.status)} />;
    body = <TimeOffBody item={read.item} viewer={viewer} wellRef={wellRef} />;
  }

  return (
    <>
      <DetailOverlay
        isOpen={id !== null}
        onClose={onClose}
        title={item ? `Time off for ${item.staff.name}` : "Time off"}
        backLabel={backLabel}
        phoneMode="page"
        header={header}
        footer={
          hasFooter && item ? (
            <TimeOffFooter
              item={item}
              viewer={viewer}
              acts={acts}
              details={details}
              decision={decision}
            />
          ) : null
        }
      >
        {body}
      </DetailOverlay>
      {item && (
        <TimeOffCancelDialog
          item={item}
          isOwn={isOwn}
          isOpen={details.isConfirmingCancel}
          isWorking={details.isCancelling}
          onClose={details.closeCancel}
          onConfirm={details.confirmCancel}
        />
      )}
    </>
  );
}

type Acts = { canApprove: boolean; canDecline: boolean; canCancel: boolean };

const NO_ACTS: Acts = { canApprove: false, canDecline: false, canCancel: false };

// Only Admins decide, and never on their own request; the rules never
// offer more than two acts at once.
function getActs(item: ExceptionRead, viewer: Viewer): Acts {
  const canDecide = isAdminViewer(viewer) && item.staff.id !== viewer.id;
  return {
    canApprove: canDecide && canApprove(item),
    canDecline: canDecide && canDecline(item),
    canCancel: canCancel(item, viewer),
  };
}

type TimeOffBodyProps = {
  item: ExceptionRead;
  viewer: Viewer;
  wellRef: RefObject<HTMLParagraphElement | null>;
};

function TimeOffBody({ item, viewer, wellRef }: TimeOffBodyProps): ReactNode {
  const isOwn = item.staff.id === viewer.id;
  const hasClashBlock = item.status === "pending" || item.status === "approved";
  return (
    <>
      {!isOwn && (
        <div className="mb-4 flex items-center gap-3">
          <Avatar name={item.staff.name} />
          <p className="min-w-0 text-[15px] leading-6">
            <span className="font-semibold">{item.staff.name}</span>
            <span className="text-(--tl-muted)"> · {roleLabel(item.staff.role)}</span>
          </p>
        </div>
      )}
      <h2 className="kit-display text-[28px] leading-9 font-light tabular-nums">
        {formatTimeOffDates(item)}
      </h2>
      <TimeOffStatusWell ref={wellRef} item={item} viewerId={viewer.id} />
      <div className="mt-6 flex flex-col gap-5">
        <DetailRow icon={CalendarDays} label="How long">
          {formatTimeOffLength(item)}
        </DetailRow>
        <DetailRow icon={MessageSquareText} label="Reason">
          {item.reason ?? <span className="text-(--tl-muted)">No reason given</span>}
        </DetailRow>
        <DetailRow icon={Clock} label={isOwn ? "You asked" : "Asked"}>
          {formatStamp(item.created_at)}
        </DetailRow>
        {hasClashBlock && <TimeOffClashBlock item={item} viewer={viewer} />}
      </div>
    </>
  );
}

type TimeOffFooterProps = {
  item: ExceptionRead;
  viewer: Viewer;
  acts: Acts;
  details: Details;
  decision: TimeOffDecisionActs;
};

// The failure line leads the footer, so it stays in view even when a
// refetch takes the button away.
function TimeOffFooter({
  item,
  viewer,
  acts,
  details,
  decision,
}: TimeOffFooterProps): ReactNode {
  const hasActs = acts.canApprove || acts.canDecline || acts.canCancel;
  const isRequest = item.staff.id === viewer.id && item.status === "pending";
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {details.actError && (
        <p
          role="alert"
          className="flex items-center gap-2 text-[13px] leading-[18px] text-(--tl-danger)"
        >
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {details.actError}
        </p>
      )}
      {hasActs && (
        <div className="flex flex-col gap-2 @md:flex-row">
          {acts.canApprove && (
            <Button
              variant="primary"
              icon={Check}
              onClick={() => decision.decide("approved")}
              className="@md:flex-1"
            >
              Approve
            </Button>
          )}
          {acts.canDecline && (
            <Button
              variant="outline"
              icon={X}
              onClick={() => decision.decide("rejected")}
              className="@md:flex-1"
            >
              Decline
            </Button>
          )}
          {acts.canCancel && (
            <Button
              variant="danger-outline"
              onClick={details.openCancel}
              className="@md:flex-1"
            >
              {isRequest ? "Cancel request" : "Cancel time off"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
