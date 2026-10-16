// The bottom of a thread: whatever you can do there right now. You type
// only in a chat you've taken over while its 24-hour window is open;
// otherwise this slot explains why not and offers the way forward
// (Take over, Take over from <name>, or reach them outside the bot).
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Bot, Copy, Hand, PhoneOff, SendHorizontal, UserRound } from "lucide-react";
import { Button, IconButton, TextLink } from "@/pages/prototype/shell-kit/kit/components/button";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import type { ConversationRead } from "@/pages/prototype/chats/types/api";
import PrototypeNote from "@/pages/prototype/chats/components/prototype-note";
import {
  formatDayAndTime,
  formatDuration,
} from "@/pages/prototype/chats/lib/time";
import type { WindowState } from "@/pages/prototype/chats/lib/time";

type ThreadFooterProps = {
  conversation: ConversationRead;
  replyWindow: WindowState;
  meId: string;
  onTakeOver: () => void;
  onTransfer: () => void;
  onSend: (body: string) => void;
  // Set where the header has no room for Hand back (the phone page).
  onHandBack?: () => void;
};

export default function ThreadFooter({
  conversation,
  replyWindow,
  meId,
  onTakeOver,
  onTransfer,
  onSend,
  onHandBack,
}: ThreadFooterProps): ReactNode {
  const holder = conversation.taken_over_by;
  const isMine = holder?.id === meId;
  const firstName = conversation.guardian?.name.split(" ")[0] ?? "this number";

  if (!conversation.is_window_open) {
    return (
      <ClosedWindow
        phone={conversation.phone_number}
        firstName={firstName}
        closedAt={replyWindow.closesAt}
        onHandBack={isMine ? onHandBack : undefined}
      />
    );
  }
  if (isMine) {
    return (
      <Composer
        hint={`${firstName} sees your Display name. Replies close in ${formatDuration(replyWindow.msLeft)}.`}
        onSend={onSend}
        onHandBack={onHandBack}
      />
    );
  }
  if (holder) {
    const holderFirst = holder.name.split(" ")[0];
    return (
      <Notice icon={UserRound} text={`${holderFirst} is replying in this chat.`}>
        <Button variant="outline" icon={Hand} onClick={onTransfer}>
          Take over from {holderFirst}
        </Button>
      </Notice>
    );
  }
  return (
    <Notice
      icon={Bot}
      text={`The bot is answering. Take over to reply to ${firstName} yourself; they're told you've joined.`}
    >
      <Button variant="primary" icon={Hand} onClick={onTakeOver}>
        Take over
      </Button>
    </Notice>
  );
}

type NoticeProps = { icon: typeof Bot; text: string; children: ReactNode };

function Notice({ icon: Icon, text, children }: NoticeProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
      <p className="flex min-w-0 flex-1 items-start gap-2 text-[14px] leading-5 text-(--tl-ink-soft)">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-(--tl-muted)" />
        {text}
      </p>
      {children}
    </div>
  );
}

type ClosedWindowProps = {
  phone: string;
  firstName: string;
  closedAt: string | null;
  onHandBack?: () => void;
};

function ClosedWindow({
  phone,
  firstName,
  closedAt,
  onHandBack,
}: ClosedWindowProps): ReactNode {
  const { showToast } = useToast();
  return (
    <div className="flex flex-col gap-3 @md:flex-row @md:items-center">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-[14px] font-semibold text-(--tl-danger)">
          <PhoneOff aria-hidden className="size-4" />
          Reply outside the bot
        </p>
        <p className="mt-0.5 text-[14px] leading-5 text-(--tl-ink-soft)">
          WhatsApp only lets the office reply within 24 hours of {firstName}'s
          last message
          {closedAt ? ` (closed ${formatDayAndTime(closedAt)})` : ""}. Call or
          text <span className="font-semibold tabular-nums">{phone}</span>.
        </p>
        {onHandBack && (
          <span className="mt-1 flex items-center gap-2">
            <TextLink onClick={onHandBack} className="text-[13px]">
              <Bot aria-hidden className="size-4" />
              Hand back to bot
            </TextLink>
            <PrototypeNote note="A taken-over chat whose window closed stays Taken over and silently drops out of Needs attention. Should it hand back by itself, or go to Needs attention? Open question." />
          </span>
        )}
      </div>
      <Button
        variant="outline"
        icon={Copy}
        onClick={() => showToast({ tone: "success", message: "Number copied" })}
      >
        Copy number
      </Button>
    </div>
  );
}

type ComposerProps = {
  hint: string;
  onSend: (body: string) => void;
  onHandBack?: () => void;
};

function Composer({ hint, onSend, onHandBack }: ComposerProps): ReactNode {
  const [draft, setDraft] = useState("");
  const isEmpty = draft.trim() === "";

  function handleSend(): void {
    if (isEmpty) return;
    onSend(draft.trim());
    setDraft("");
  }

  // Enter sends, Shift+Enter is a new line, as in WhatsApp Web.
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    handleSend();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <label className="sr-only" htmlFor="chat-composer">
          Reply
        </label>
        <textarea
          id="chat-composer"
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a reply…"
          className="max-h-40 min-h-11 flex-1 resize-none rounded-[22px] border border-(--tl-field-border) bg-(--tl-surface) px-4 py-2.5 text-[15px] leading-6 [field-sizing:content] placeholder:text-(--tl-muted) hover:border-(--tl-primary)"
        />
        <IconButton
          icon={SendHorizontal}
          label="Send"
          variant="primary"
          onClick={handleSend}
          disabled={isEmpty}
        />
      </div>
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[12px] leading-4 text-(--tl-muted)">{hint}</p>
        {onHandBack && (
          <TextLink onClick={onHandBack} className="shrink-0 text-[13px]">
            <Bot aria-hidden className="size-4" />
            Hand back
          </TextLink>
        )}
      </div>
    </div>
  );
}
