import type { ReactNode } from "react";
import type { ConversationDetail } from "@/lib/queries/conversations";

type HandBackControlProps = {
  conversation: ConversationDetail;
  currentUserId: string | null;
};

// Ticket 08 fills this: "Hand back to bot" in the pane header, for the
// holder only. The stub renders nothing.
export default function HandBackControl({
  conversation,
  currentUserId,
}: HandBackControlProps): ReactNode {
  void conversation;
  void currentUserId;
  return null;
}
