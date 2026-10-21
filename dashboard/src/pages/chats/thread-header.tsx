// Who the chat is with, how to reach them, and who is handling it.
import type { ReactNode } from "react";
import { ChevronRight, CircleAlert, UserRoundPlus } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Avatar,
  Badge,
  ChatHandlerBadge,
} from "@/components/kit/components/badges";
import { ReplyWindowCue } from "@/components/kit/components/reply-window-cue";
import Select from "@/components/kit/components/select";
import { useChatLanguage } from "@/hooks/use-chat-language";
import { getChatTitle } from "@/lib/chats/labels";
import { LANGUAGE_LABELS, languageFromOption } from "@/lib/guardians/language";
import type { ConversationDetail } from "@/lib/queries/conversations";
import HandBackControl from "@/pages/chats/hand-back-control";
import type { ThreadContainer } from "@/pages/chats/thread-footer";

const LANGUAGE_OPTIONS = [
  { value: "", label: "Language not detected" },
  { value: "en", label: LANGUAGE_LABELS.en },
  { value: "es", label: LANGUAGE_LABELS.es },
];

// The Families area's route; the Guardian id serves as the member id.
function getFamilyPath(guardianId: string): string {
  return `/families/${guardianId}?guardian=${guardianId}`;
}

type ThreadHeaderProps = {
  conversation: ConversationDetail;
  currentUserId: string | null;
  container: ThreadContainer;
};

export default function ThreadHeader({
  conversation,
  currentUserId,
  container,
}: ThreadHeaderProps): ReactNode {
  const language = useChatLanguage(conversation);
  const isPane = container === "pane";
  const { guardian, phone_number: phone } = conversation;
  const holder = conversation.taken_over_by;
  const isMine = holder !== null && holder.id === currentUserId;
  const isBot = conversation.status === "bot" || holder === null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Avatar name={guardian?.name ?? null} size={isPane ? "lg" : "md"} />
        <div className="min-w-0 flex-1">
          <h2 className="kit-display text-[22px] leading-[30px] font-bold">
            {guardian ? (
              <Link
                to={getFamilyPath(guardian.id)}
                className="group -my-[7px] inline-flex min-h-11 max-w-full items-center gap-1 rounded-[14px] transition-colors duration-150 hover:text-(--tl-link)"
              >
                <span className="truncate">
                  {getChatTitle(guardian, phone)}
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
                />
                <span className="sr-only">: open family</span>
              </Link>
            ) : (
              <span className="tabular-nums">{phone}</span>
            )}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 text-[14px] leading-5 text-(--tl-muted)">
            {guardian && (
              <>
                <span className="tabular-nums">{phone}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <Select
              variant="inline"
              aria-label="Guardian language"
              label="Guardian language"
              value={language.value ?? ""}
              onValueChange={(next) => language.change(languageFromOption(next))}
              options={LANGUAGE_OPTIONS}
            />
          </p>
        </div>
        {isPane && (
          <div className="shrink-0">
            <HandBackControl
              conversation={conversation}
              currentUserId={currentUserId}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {conversation.intake_in_progress && (
          <Badge tone="yellow" icon={UserRoundPlus}>
            Intake in progress
          </Badge>
        )}
        <ChatHandlerBadge
          handler={isBot ? "Bot" : holder.name}
          isYou={!isBot && isMine}
        />
        {conversation.is_window_open && (
          <ReplyWindowCue
            lastClientMessageAt={conversation.last_client_message_at}
            isTakenOverByYou={!isBot && isMine}
          />
        )}
      </div>
      {language.hasFailed && (
        <p
          role="alert"
          className="kit-fade flex items-center gap-1.5 text-[13px] font-medium text-(--tl-danger)"
        >
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          Couldn’t change the language. Try again.
        </p>
      )}
    </div>
  );
}
