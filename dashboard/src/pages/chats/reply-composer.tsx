// The holder's reply box. Enter sends and Shift+Enter is a new line, as
// in WhatsApp Web; the draft clears at once and the bubble shows
// "Sending" until the stream echoes it.
import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Bot, SendHorizontal, WifiOff } from "lucide-react";
import { IconButton, TextLink } from "@/components/kit/components/button";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { cn } from "@/components/kit/tokens";
import type { ChatComposer } from "@/hooks/use-chat-thread";
import { shouldSubmitOnKey } from "@/lib/message-composer/shouldSubmitOnKey";
import FooterAlert from "@/pages/chats/footer-alert";

type ReplyComposerProps = {
  composer: ChatComposer;
  hint: string;
  // Set on the phone page, where the header has no room for Hand back.
  onHandBack: (() => void) | null;
};

export default function ReplyComposer({
  composer,
  hint,
  onHandBack,
}: ReplyComposerProps): ReactNode {
  const [draft, setDraft] = useState("");
  const body = draft.trim();
  const isDisabled = !composer.isConnected;

  function handleSend(): void {
    if (body === "" || isDisabled) return;
    composer.send(body);
    setDraft("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    const isSubmit = shouldSubmitOnKey({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.keyCode,
    });
    if (!isSubmit) return;
    event.preventDefault();
    handleSend();
  }

  return (
    <div className="flex flex-col gap-2">
      {composer.error !== null && <FooterAlert>{composer.error}</FooterAlert>}
      <div className="flex items-end gap-2">
        <label className="sr-only" htmlFor="chat-reply">
          Reply
        </label>
        <textarea
          id="chat-reply"
          data-composer
          rows={1}
          value={draft}
          // Read-only, not disabled, so a drop doesn't throw focus to body.
          readOnly={isDisabled}
          aria-disabled={isDisabled || undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a reply…"
          className={cn(
            getControlClasses(false),
            "max-h-40 min-h-11 flex-1 resize-none rounded-[20px] px-4 py-2.5 leading-6 [field-sizing:content]",
            isDisabled &&
              "cursor-not-allowed border-(--tl-border) bg-(--tl-surface-sunk) text-(--tl-muted) hover:border-(--tl-border)",
          )}
        />
        <IconButton
          icon={SendHorizontal}
          label="Send"
          variant="primary"
          onClick={handleSend}
          disabled={body === "" || isDisabled}
        />
      </div>
      {isDisabled && (
        <p
          role="status"
          className="flex items-center gap-1.5 px-1 text-[13px] leading-5 text-(--tl-muted)"
        >
          <WifiOff aria-hidden className="size-4 shrink-0" />
          Reconnecting… Replies send once you’re back online.
        </p>
      )}
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[12px] leading-4 text-(--tl-muted)">{hint}</p>
        {onHandBack && (
          <TextLink
            data-hand-back
            onClick={onHandBack}
            className="shrink-0 text-[13px]"
          >
            <Bot aria-hidden className="size-4" />
            Hand back
          </TextLink>
        )}
      </div>
    </div>
  );
}
