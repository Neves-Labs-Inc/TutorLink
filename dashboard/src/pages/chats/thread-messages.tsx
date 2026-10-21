// The message area: older-page control, day groups, and the empty and
// loading states. Keeps the newest message in view as it grows.
import { useRef } from "react";
import type { ReactNode } from "react";
import { ArrowUp, MessageCircle } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { useNow } from "@/components/kit/hooks/use-now";
import { EmptyState, InlineError } from "@/components/kit/states/states";
import type { ChatThread } from "@/hooks/use-chat-thread";
import type { NoticeRetry } from "@/hooks/use-notice-retry";
import { useThreadScroll } from "@/hooks/use-thread-scroll";
import { formatDayHeading, isSameDay } from "@/lib/chats/time";
import type { Message } from "@/lib/queries/conversations";
import DayGroupItem from "@/pages/chats/day-group-item";
import MessageItem from "@/pages/chats/message-item";
import BubbleSkeletons from "@/pages/chats/bubble-skeletons";
import SystemLine from "@/pages/chats/system-line";

function isLiveMessage(message: Message, liveAfterMs: number | null): boolean {
  return liveAfterMs !== null && Date.parse(message.created_at) > liveAfterMs;
}

type ThreadMessagesProps = {
  thread: ChatThread;
  isWindowOpen: boolean;
  currentUserId: string | null;
  noticeRetry: NoticeRetry;
};

export default function ThreadMessages({
  thread,
  isWindowOpen,
  currentUserId,
  noticeRetry,
}: ThreadMessagesProps): ReactNode {
  const anchorRef = useRef<HTMLDivElement>(null);
  const nowMs = useNow();
  const { messages } = thread;
  useThreadScroll(anchorRef, messages);

  let content: ReactNode;
  if (thread.messageState === "loading") {
    content = <BubbleSkeletons label="Loading messages" />;
  } else if (thread.messageState === "empty") {
    content = (
      <EmptyState
        isBare
        icon={MessageCircle}
        title="No messages yet"
        body="Messages show here as soon as the Guardian writes."
      />
    );
  } else {
    content = (
      <>
        {thread.olderState === "error" ? (
          <InlineError
            message="Couldn’t load older messages. Check your connection."
            onRetry={thread.loadOlder}
          />
        ) : (
          thread.hasOlder && (
            <div className="flex justify-center">
              <Button
                variant="ghost"
                icon={ArrowUp}
                isLoading={thread.olderState === "fetching"}
                onClick={thread.loadOlder}
              >
                Load older messages
              </Button>
            </div>
          )
        )}
        <ol aria-label="Messages" className="flex flex-col gap-3">
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const isNewDay =
              !previous || !isSameDay(previous.created_at, message.created_at);
            const isLive = isLiveMessage(message, thread.liveAfterMs);
            return (
              <DayGroupItem
                key={message.id}
                heading={
                  isNewDay ? formatDayHeading(message.created_at, nowMs) : null
                }
              >
                {message.author_kind === "system" ? (
                  <SystemLine
                    message={message}
                    isWindowOpen={isWindowOpen}
                    isLive={isLive}
                    noticeRetry={noticeRetry}
                  />
                ) : (
                  <MessageItem
                    message={message}
                    currentUserId={currentUserId}
                    isLive={isLive}
                  />
                )}
              </DayGroupItem>
            );
          })}
        </ol>
      </>
    );
  }

  return (
    <div ref={anchorRef} className="flex flex-col gap-4">
      {content}
    </div>
  );
}
