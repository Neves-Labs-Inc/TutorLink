// The bottom of a thread: whatever the viewer can do there right now.
// Only the holder types, and only while the Guardian's 24-hour window is
// open; otherwise it explains why not and offers the way forward.
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Bot, Hand, UserRound } from "lucide-react";
import { useNow } from "@/components/kit/hooks/use-now";
import { Button } from "@/components/kit/components/button";
import {
  formatTimeLeft,
  getReplyWindow,
} from "@/components/kit/lib/reply-window";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import type { ChatComposer } from "@/hooks/use-chat-thread";
import { useFooterFocus } from "@/hooks/use-footer-focus";
import { useHandBack } from "@/hooks/use-hand-back";
import { useTakeover } from "@/hooks/use-takeover";
import { getFirstName } from "@/lib/chats/labels";
import type { ConversationDetail } from "@/lib/queries/conversations";
import ClosedWindowNotice from "@/pages/chats/closed-window-notice";
import FooterAlert from "@/pages/chats/footer-alert";
import FooterNotice from "@/pages/chats/footer-notice";
import ReplyComposer from "@/pages/chats/reply-composer";

export type ThreadContainer = "pane" | "overlay";

type ThreadFooterProps = {
  conversation: ConversationDetail;
  currentUserId: string | null;
  container: ThreadContainer;
  composer: ChatComposer;
};

export default function ThreadFooter({
  conversation,
  currentUserId,
  container,
  composer,
}: ThreadFooterProps): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null);
  const nowMs = useNow();
  const firstName =
    conversation.guardian === null
      ? "this number"
      : getFirstName(conversation.guardian.name);
  const takeover = useTakeover(conversation.id, firstName);
  const handBack = useHandBack();
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  // Kept while the dialog is open: a refusal's refetch may change holder.
  const [transferHolder, setTransferHolder] = useState("");
  useFooterFocus(rootRef, conversation.id);

  const holder =
    conversation.status === "human" ? conversation.taken_over_by : null;
  const isMine = holder !== null && holder.id === currentUserId;
  const holderFirst = holder === null ? "" : getFirstName(holder.name);
  const handleHandBack = (): void => handBack(conversation);
  const replyWindow = getReplyWindow(
    conversation.last_client_message_at,
    nowMs,
  );

  async function handleTransfer(): Promise<void> {
    const isDone = await takeover.transfer();
    if (isDone) setIsTransferOpen(false);
  }

  let content: ReactNode;
  if (!conversation.is_window_open) {
    content = (
      <ClosedWindowNotice
        phone={conversation.phone_number}
        firstName={firstName}
        closedAt={replyWindow.closesAt}
        onHandBack={isMine ? handleHandBack : null}
      />
    );
  } else if (isMine) {
    content = (
      <ReplyComposer
        composer={composer}
        hint={`${firstName} sees your Display name. Replies close in ${formatTimeLeft(replyWindow.msLeft)}.`}
        onHandBack={container === "overlay" ? handleHandBack : null}
      />
    );
  } else if (holder !== null) {
    content = (
      <FooterNotice
        icon={UserRound}
        text={`${holderFirst} is replying in this chat.`}
      >
        <Button
          variant="outline"
          icon={Hand}
          data-transfer
          onClick={() => {
            takeover.clearTransferError();
            setTransferHolder(holderFirst);
            setIsTransferOpen(true);
          }}
          className="w-full @md:w-auto"
        >
          Take over from {holderFirst}
        </Button>
      </FooterNotice>
    );
  } else {
    content = (
      <FooterNotice
        icon={Bot}
        text={`The bot is answering. Take over to reply to ${firstName} yourself; they’re told you’ve joined.`}
      >
        <Button
          variant="primary"
          icon={Hand}
          data-takeover
          isLoading={takeover.pending === "takeover"}
          onClick={() => void takeover.takeOver()}
          className="w-full @md:w-auto"
        >
          Take over
        </Button>
      </FooterNotice>
    );
  }

  return (
    <div
      ref={rootRef}
      data-slot="thread-footer"
      data-conversation={conversation.id}
      data-container={container}
      className="flex w-full flex-col gap-3"
    >
      {takeover.takeoverError !== null && (
        <FooterAlert>{takeover.takeoverError}</FooterAlert>
      )}
      {content}
      <ConfirmDialog
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        onConfirm={() => void handleTransfer()}
        title={`Take over from ${transferHolder}?`}
        confirmLabel="Take over"
        keepLabel={`Leave it with ${transferHolder}`}
        isWorking={takeover.pending === "transfer"}
      >
        <p>
          {transferHolder} can no longer reply here. {firstName} is told
          you’ve joined.
        </p>
        {takeover.transferError !== null && (
          <div className="mt-3">
            <FooterAlert>{takeover.transferError}</FooterAlert>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
