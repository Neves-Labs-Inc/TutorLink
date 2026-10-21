import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { useHandBack } from "@/hooks/use-hand-back";
import type { ConversationDetail } from "@/lib/queries/conversations";

type HandBackControlProps = {
  conversation: ConversationDetail;
  currentUserId: string | null;
};

// "Hand back to bot" in the pane header, for the holder only (the API
// lets anyone release; the UI keeps it to the holder, as approved).
export default function HandBackControl({
  conversation,
  currentUserId,
}: HandBackControlProps): ReactNode {
  const handBack = useHandBack();
  const isMine =
    conversation.status === "human" &&
    conversation.taken_over_by !== null &&
    conversation.taken_over_by.id === currentUserId;
  if (!isMine) return null;

  return (
    <Button
      variant="outline"
      icon={Bot}
      data-hand-back
      onClick={() => handBack(conversation)}
    >
      Hand back to bot
    </Button>
  );
}
