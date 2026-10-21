// One chat: the pinned header and Needs attention card, the messages,
// and the footer slot. From 1152px it fills the split's pane; below
// that it is the kit DetailOverlay (a page pushed in on phones).
import { useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { ErrorState, Skeleton } from "@/components/kit/states/states";
import { cn } from "@/components/kit/tokens";
import { useChatThread } from "@/hooks/use-chat-thread";
import { useNoticeRetry } from "@/hooks/use-notice-retry";
import { getChatTitle } from "@/lib/chats/labels";
import { meQueries } from "@/lib/queries/me";
import AttentionCard from "@/pages/chats/attention-card";
import BubbleSkeletons from "@/pages/chats/bubble-skeletons";
import ThreadFooter from "@/pages/chats/thread-footer";
import type { ThreadContainer } from "@/pages/chats/thread-footer";
import ThreadHeader from "@/pages/chats/thread-header";
import ThreadMessages from "@/pages/chats/thread-messages";

type ChatThreadProps = {
  conversationId: string;
  container: ThreadContainer;
  onClose: () => void;
};

export function ChatThread({
  conversationId,
  container,
  onClose,
}: ChatThreadProps): ReactNode {
  const thread = useChatThread(conversationId);
  const noticeRetry = useNoticeRetry(conversationId);
  const currentUserId = useQuery(meQueries.detail()).data?.id ?? null;
  const isPane = container === "pane";
  const { detail } = thread;

  // A flag that shows up after the chat was seen unflagged (stream or Undo)
  // fades in; one already there when the chat opens does not.
  const [unflaggedSeenFor, setUnflaggedSeenFor] = useState<string | null>(null);
  if (
    detail !== null &&
    detail.flag_reason === null &&
    unflaggedSeenFor !== conversationId
  ) {
    setUnflaggedSeenFor(conversationId);
  }

  let label = "Chat";
  let header: ReactNode = null;
  let attention: ReactNode = null;
  let body: ReactNode;
  let footer: ReactNode = null;
  if (thread.load === "error") {
    body = (
      <ErrorState
        isBare={isPane}
        title="Couldn’t load this chat"
        body="Check your connection and try again."
        onRetry={thread.retryLoad}
        isRetrying={thread.isRetrying}
      />
    );
  } else if (detail === null) {
    header = <HeaderSkeleton container={container} />;
    body = <BubbleSkeletons label="Loading chat" />;
  } else {
    label = `Chat with ${getChatTitle(detail.guardian, detail.phone_number)}`;
    header = (
      <ThreadHeader
        conversation={detail}
        currentUserId={currentUserId}
        container={container}
      />
    );
    if (detail.flag_reason !== null) {
      attention = (
        <AttentionCard
          conversation={detail}
          isCompact={!isPane}
          isLive={unflaggedSeenFor === conversationId}
        />
      );
    }
    body = (
      <ThreadMessages
        thread={thread}
        isWindowOpen={detail.is_window_open}
        currentUserId={currentUserId}
        noticeRetry={noticeRetry}
      />
    );
    footer = (
      <ThreadFooter
        conversation={detail}
        currentUserId={currentUserId}
        container={container}
      />
    );
  }

  if (!isPane) {
    return (
      <DetailOverlay
        isOpen
        onClose={onClose}
        title={label}
        backLabel="Chats"
        phoneMode="page"
        isHeaderPinned
        header={
          header && (
            <div className="flex flex-col gap-3 pb-1">
              {header}
              {attention}
            </div>
          )
        }
        footer={footer && <div className="w-full">{footer}</div>}
      >
        {body}
      </DetailOverlay>
    );
  }

  const isBare = thread.load === "error";
  return (
    <section aria-label={label} className="flex h-full min-h-0 flex-col">
      {header && (
        <div className="shrink-0 border-b border-(--tl-border) px-6 pt-5 pb-4">
          {header}
        </div>
      )}
      {attention && (
        <div className="shrink-0 border-b border-(--tl-border) px-6 py-3">
          {attention}
        </div>
      )}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-6 py-5",
          isBare && "flex items-center justify-center",
        )}
      >
        {body}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-(--tl-border) bg-(--tl-surface) px-6 pt-3 pb-4">
          {footer}
        </div>
      )}
    </section>
  );
}

type HeaderSkeletonProps = { container: ThreadContainer };

function HeaderSkeleton({ container }: HeaderSkeletonProps): ReactNode {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Skeleton
          className={cn(
            "shrink-0 rounded-full",
            container === "pane" ? "size-12" : "size-10",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
          <Skeleton className="h-5 w-40 rounded-full" />
          <Skeleton className="h-3.5 w-28 rounded-full" />
        </div>
      </div>
      <Skeleton className="h-7 w-24 rounded-full" />
    </div>
  );
}
