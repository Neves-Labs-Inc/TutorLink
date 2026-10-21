import type { ReactNode } from "react";
import { AttentionBadge } from "@/components/kit/components/badges";
import { FLAG_REASON_LABEL } from "@/lib/chats/labels";
import type { ConversationDetail } from "@/lib/queries/conversations";

type AttentionCardProps = {
  conversation: ConversationDetail;
  // The phone card shows the reason and actions only.
  isCompact: boolean;
};

// Ticket 09 fills this: the pinned Needs attention card and its acts.
export default function AttentionCard({
  conversation,
  isCompact,
}: AttentionCardProps): ReactNode {
  if (conversation.flag_reason === null) return null;

  return (
    <div data-slot="attention-card" data-compact={isCompact}>
      <AttentionBadge reason={FLAG_REASON_LABEL[conversation.flag_reason]} />
    </div>
  );
}
