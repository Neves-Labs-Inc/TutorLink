// One chat: header (who, how to reach them, who's handling it), the
// Needs attention card, the messages, and the footer slot. It renders
// either inside the desktop split pane or in the kit's DetailOverlay
// (a page pushed in from the right on narrow widths).
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Bot, ChevronRight, MessageCircle } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import Select from "@/components/kit/components/select";
import { ConfirmDialog } from "@/components/kit/overlays/dialog";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { useToast } from "@/components/kit/overlays/use-toast";
import { EmptyState, ErrorState, Skeleton } from "@/components/kit/states/states";
import { cn } from "@/components/kit/tokens";
import type {
  ConversationRead,
  Language,
  MessageRead,
} from "@/pages/prototype/chats/types/api";
import type { ChatsApi } from "@/pages/prototype/chats/hooks/use-chats";
import { getChatTitle, LANGUAGE_LABEL } from "@/pages/prototype/chats/lib/labels";
import {
  formatDayHeading,
  getWindowState,
  isSameDay,
} from "@/pages/prototype/chats/lib/time";
import type { WindowState } from "@/pages/prototype/chats/lib/time";
import {
  GuardianAvatar,
  HolderBadge,
  NewNumberBadge,
  WindowCue,
} from "@/pages/prototype/chats/components/chat-badges";
import AttentionCard from "@/pages/prototype/chats/components/attention-card";
import MessageItem from "@/pages/prototype/chats/components/message-item";
import PrototypeNote from "@/pages/prototype/chats/components/prototype-note";
import ThreadFooter from "@/pages/prototype/chats/components/thread-footer";

export type ThreadLoad = "ready" | "loading" | "error";

type ChatThreadProps = {
  chats: ChatsApi;
  conversationId: string;
  meId: string;
  load: ThreadLoad;
  container: "pane" | "overlay";
  onClose: () => void;
  onRetryLoad: () => void;
};

export default function ChatThread({
  chats,
  conversationId,
  meId,
  load,
  container,
  onClose,
  onRetryLoad,
}: ChatThreadProps): ReactNode {
  const { showToast } = useToast();
  const [dialog, setDialog] = useState<"hand-back" | "transfer" | null>(null);
  const conversation = chats.getConversation(conversationId);
  if (conversation === null) return null;

  const messages = chats.getMessages(conversationId);
  const replyWindow = getWindowState(conversation.last_client_message_at);
  const title = getChatTitle(conversation.guardian, conversation.phone_number);
  const firstName = conversation.guardian?.name.split(" ")[0] ?? "The Guardian";
  const holderFirst = conversation.taken_over_by?.name.split(" ")[0] ?? "";
  const isMine = conversation.taken_over_by?.id === meId;

  function handleOtherArea(action: string): void {
    showToast({
      tone: "info",
      message: `${action} opens in its own area (Bookings / Families prototypes).`,
    });
  }

  function handleMarkDone(): void {
    chats.markDone(conversationId);
    showToast({ tone: "success", message: `${title}: marked done` });
  }

  function handleReactivation(isApproved: boolean): void {
    const child = conversation?.reactivation_request?.child.name ?? "Child";
    chats.resolveReactivation(conversationId, isApproved);
    showToast({
      tone: "success",
      message: isApproved ? `${child} restored` : "Request declined",
    });
  }

  function handleHandBack(): void {
    chats.handBack(conversationId);
    setDialog(null);
    showToast({ tone: "success", message: `Handed back. The bot is answering ${firstName}.` });
  }

  function handleTransfer(): void {
    chats.transferToMe(conversationId);
    setDialog(null);
  }

  const header = (
    <ThreadHeader
      conversation={conversation}
      title={title}
      meId={meId}
      isMine={isMine}
      isInPane={container === "pane"}
      replyWindow={replyWindow}
      onHandBack={() => setDialog("hand-back")}
      onLanguage={(language) => chats.setLanguage(conversationId, language)}
      onOpenGuardian={() => handleOtherArea("The Guardian")}
    />
  );

  // Pinned above the messages so the reason and its actions never
  // scroll away while you read the chat.
  const attention =
    load === "ready" && conversation.flag_reason ? (
      <AttentionCard
        conversation={conversation}
        onMarkDone={handleMarkDone}
        onResolveReactivation={handleReactivation}
        onOtherArea={handleOtherArea}
        isCompact={container === "overlay"}
      />
    ) : null;
  let body: ReactNode = (
    <MessageList
      messages={messages}
      meId={meId}
      canRetry={conversation.is_window_open}
      onRetry={(messageId) => chats.retry(conversationId, messageId)}
    />
  );
  let footer: ReactNode = (
    <ThreadFooter
      conversation={conversation}
      replyWindow={replyWindow}
      meId={meId}
      onTakeOver={() => chats.takeOver(conversationId)}
      onTransfer={() => setDialog("transfer")}
      onSend={(text) => chats.send(conversationId, text)}
      onHandBack={container === "overlay" ? () => setDialog("hand-back") : undefined}
    />
  );
  if (load === "loading") {
    body = <ThreadSkeleton />;
    footer = null;
  } else if (load === "error") {
    body = (
      <ErrorState
        title="This chat didn't load"
        body="Check your connection and try again. Nothing was sent."
        onRetry={onRetryLoad}
      />
    );
    footer = null;
  }

  const dialogs = (
    <>
      <ConfirmDialog
        isOpen={dialog === "hand-back"}
        onClose={() => setDialog(null)}
        onConfirm={handleHandBack}
        title="Hand back to the bot?"
        confirmLabel="Hand back"
        keepLabel="Keep replying"
      >
        {firstName} is told the bot is helping again. You can take over again
        while the 24-hour window is open.
        {conversation.flag_reason && (
          <span className="mt-2 flex items-center gap-2">
            The chat stays in Needs attention until someone marks it done.
            <PrototypeNote note="Should Hand back also mark the chat done, ask, or leave the flag? Open question; placeholder leaves it." />
          </span>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        isOpen={dialog === "transfer"}
        onClose={() => setDialog(null)}
        onConfirm={handleTransfer}
        title={`Take over from ${holderFirst}?`}
        confirmLabel="Take over"
        keepLabel={`Leave it with ${holderFirst}`}
      >
        {holderFirst} can no longer reply here. {firstName} is told you've
        joined.
      </ConfirmDialog>
    </>
  );

  if (container === "overlay") {
    return (
      <>
        <DetailOverlay
          isOpen
          onClose={onClose}
          title={`Chat with ${title}`}
          backLabel="Chats"
          phoneMode="page"
          footer={footer ? <div className="w-full">{footer}</div> : undefined}
        >
          <ScrollToEnd trigger={messages.length} />
          {/* The kit's overlay header scrolls with its content, so a long
              chat would push the name off screen; pin it here instead. */}
          <div className="sticky top-0 z-10 -mx-5 -mt-2 flex flex-col gap-3 border-b border-(--tl-border) bg-(--tl-canvas) px-5 pt-3 pb-3 @2xl:-mx-6 @2xl:bg-(--tl-surface) @2xl:px-6">
            {header}
            {attention}
          </div>
          <div className="pt-4">{body}</div>
        </DetailOverlay>
        {dialogs}
      </>
    );
  }

  return (
    <section aria-label={`Chat with ${title}`} className="flex h-full min-h-0 flex-col">
      <div className="border-b border-(--tl-border) px-6 pt-5 pb-4">{header}</div>
      {attention && (
        <div className="border-b border-(--tl-border) px-6 py-3">{attention}</div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <ScrollToEnd trigger={messages.length} />
        {body}
      </div>
      {footer && (
        <div className="border-t border-(--tl-border) bg-(--tl-surface) px-6 pt-3 pb-4">
          {footer}
        </div>
      )}
      {dialogs}
    </section>
  );
}

type ThreadHeaderProps = {
  conversation: ConversationRead;
  title: string;
  meId: string;
  isMine: boolean;
  isInPane: boolean;
  replyWindow: WindowState;
  onHandBack: () => void;
  onLanguage: (language: Language | null) => void;
  onOpenGuardian: () => void;
};

function ThreadHeader({
  conversation,
  title,
  meId,
  isMine,
  isInPane,
  replyWindow,
  onHandBack,
  onLanguage,
  onOpenGuardian,
}: ThreadHeaderProps): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <GuardianAvatar guardian={conversation.guardian} size={isInPane ? "lg" : "md"} />
        <div className="min-w-0 flex-1">
          <h2 className="kit-display truncate text-[22px] leading-[30px] font-bold">
            {conversation.guardian ? (
              // The name opens the Guardian, as a contact name does in WhatsApp.
              <button
                type="button"
                onClick={onOpenGuardian}
                className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded-[10px] text-left hover:text-(--tl-link)"
              >
                <span className="truncate">{title}</span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-(--tl-muted)" />
                <span className="sr-only">: open Guardian</span>
              </button>
            ) : (
              title
            )}
          </h2>
          <p className="flex items-center gap-x-2 text-[14px] leading-5 whitespace-nowrap text-(--tl-muted)">
            {conversation.guardian && (
              <span className="tabular-nums">{conversation.phone_number}</span>
            )}
            <LanguagePicker
              value={conversation.language}
              onChange={onLanguage}
            />
          </p>
        </div>
        {isMine && isInPane && (
          <Button variant="outline" icon={Bot} onClick={onHandBack}>
            Hand back to bot
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {conversation.guardian === null && <NewNumberBadge />}
        <HolderBadge
          status={conversation.status}
          holder={conversation.taken_over_by}
          meId={meId}
        />
        {conversation.is_window_open && (
          <WindowCue replyWindow={replyWindow} isTakenOverByMe={isMine} />
        )}
      </div>
    </div>
  );
}

type LanguagePickerProps = {
  value: Language | null;
  onChange: (language: Language | null) => void;
};

// The Guardian language the bot (and reminders) use on this chat.
function LanguagePicker({ value, onChange }: LanguagePickerProps): ReactNode {
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span aria-hidden>·</span>
      <Select
        variant="inline"
        aria-label="Guardian language"
        label="Guardian language"
        value={value ?? ""}
        onValueChange={(next) => onChange(next === "" ? null : (next as Language))}
        options={[
          { value: "", label: "Language not detected" },
          ...(Object.keys(LANGUAGE_LABEL) as Language[]).map((language) => ({
            value: language,
            label: LANGUAGE_LABEL[language],
          })),
        ]}
      />
    </span>
  );
}

type MessageListProps = {
  messages: MessageRead[];
  meId: string;
  canRetry: boolean;
  onRetry: (messageId: string) => void;
};

function MessageList({
  messages,
  meId,
  canRetry,
  onRetry,
}: MessageListProps): ReactNode {
  if (messages.length === 0) {
    return (
      <EmptyState
        isBare
        icon={MessageCircle}
        title="No messages yet"
        body="Messages show here as soon as the Guardian writes."
      />
    );
  }
  return (
    <ol aria-label="Messages" className="flex flex-col gap-3">
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const isNewDay =
          !previous || !isSameDay(previous.created_at, message.created_at);
        return (
          <DayGroupItem
            key={message.id}
            heading={isNewDay ? formatDayHeading(message.created_at) : null}
          >
            <MessageItem
              message={message}
              meId={meId}
              canRetry={canRetry}
              onRetry={onRetry}
            />
          </DayGroupItem>
        );
      })}
    </ol>
  );
}

type DayGroupItemProps = { heading: string | null; children: ReactNode };

function DayGroupItem({ heading, children }: DayGroupItemProps): ReactNode {
  return (
    <>
      {heading && (
        <li aria-hidden className="flex items-center gap-3 py-1">
          <span className="h-px flex-1 bg-(--tl-border)" />
          <span className="text-[12px] font-semibold text-(--tl-muted)">
            {heading}
          </span>
          <span className="h-px flex-1 bg-(--tl-border)" />
        </li>
      )}
      {children}
    </>
  );
}

// Keeps the newest message in view when the chat opens or grows.
function ScrollToEnd({ trigger }: { trigger: number }): ReactNode {
  const markerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let scroller = markerRef.current?.parentElement ?? null;
    while (scroller && getComputedStyle(scroller).overflowY !== "auto") {
      scroller = scroller.parentElement;
    }
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [trigger]);
  return <span ref={markerRef} aria-hidden className="hidden" />;
}

function ThreadSkeleton(): ReactNode {
  const widths = ["w-3/5", "w-2/5", "w-4/5", "w-1/2", "w-3/5"];
  return (
    <div role="status" aria-label="Loading chat" className="flex flex-col gap-4">
      {widths.map((width, index) => (
        <div
          key={index}
          className={cn("flex", index % 2 === 0 ? "justify-start" : "justify-end")}
        >
          <Skeleton className={cn("h-12 rounded-[20px]", width)} />
        </div>
      ))}
    </div>
  );
}
