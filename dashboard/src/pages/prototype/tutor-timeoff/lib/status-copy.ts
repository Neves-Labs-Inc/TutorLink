// Time off status in one plain sentence: what it means for the person,
// the pain point Tutors had ("is it approved or not?").
import {
  formatStamp,
  getFirstName,
} from "@/pages/prototype/tutor-timeoff/lib/labels";
import type {
  ExceptionRead,
  ExceptionReadStatus,
} from "@/pages/prototype/tutor-timeoff/types/api";

// `viewerId` decides "you" versus a name.
export function getStatusSentence(item: ExceptionRead, viewerId: string): string {
  const isOwn = item.staff.id === viewerId;
  const decider = item.decided_by;
  const decidedByText =
    decider && decider.id === viewerId ? "you" : getFirstName(decider?.name ?? "an Admin");
  const canceller = item.cancelled_by;
  const cancelledByText =
    canceller && canceller.id === viewerId ? "you" : (canceller?.name ?? "someone");
  // The wire has no "entered by": a decision stamped the moment the row
  // was made means an Admin entered it (an API gap, see the report).
  const isEntered = decider !== null && item.decided_at === item.created_at;
  const isSelfEntered = isEntered && decider.id === item.staff.id;
  const blockedText = isOwn
    ? "You can’t be booked in these times."
    : "They can’t be booked in these times.";
  let approvedText = `Approved by ${decidedByText}, ${formatStamp(item.decided_at ?? item.created_at)}. ${blockedText}`;
  if (isSelfEntered) {
    approvedText = "Took effect straight away: an Admin’s own time off needs no approval.";
  } else if (isEntered) {
    approvedText = `Added by ${decidedByText}, so it took effect straight away. ${blockedText}`;
  }

  const sentences: Record<ExceptionReadStatus, string> = {
    pending: isOwn
      ? "Waiting for an Admin. You can still be booked until it’s approved."
      : "Waiting for an Admin to approve or decline.",
    approved: approvedText,
    rejected: `Declined by ${decidedByText}, ${formatStamp(item.decided_at ?? item.created_at)}. ${isOwn ? "You can still be booked." : "They can still be booked."}`,
    cancelled: `Cancelled by ${cancelledByText}, ${formatStamp(item.cancelled_at ?? item.created_at)}.`,
    expired: "Nobody decided before it started, so it never took effect.",
  };
  return sentences[item.status];
}
