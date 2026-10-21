import type { ReactNode } from "react";
import type { ConversationDetail } from "@/lib/queries/conversations";

export type ThreadContainer = "pane" | "overlay";

type ThreadFooterProps = {
  conversation: ConversationDetail;
  currentUserId: string | null;
  container: ThreadContainer;
};

// Ticket 08 fills this: Take over, the composer, and the closed-window
// notice, whichever the viewer can do right now.
export default function ThreadFooter({
  conversation,
  container,
}: ThreadFooterProps): ReactNode {
  return (
    <div
      data-slot="thread-footer"
      data-conversation={conversation.id}
      data-container={container}
      className="min-h-11"
    />
  );
}
