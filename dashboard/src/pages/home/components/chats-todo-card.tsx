// To do › Chats: flagged chats in the server's order (closest to losing
// the Takeover first). A row opens the chat.
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle } from "lucide-react";
import { AttentionBadge } from "@/components/kit/components/badges";
import { ReplyWindowCue } from "@/components/kit/components/reply-window-cue";
import TodoCard from "@/components/kit/components/todo-card";
import { FLAG_REASON_LABEL, getChatTitle } from "@/lib/chats/labels";
import type { Conversation } from "@/lib/queries/conversations";
import TodoRow from "@/pages/home/components/todo-row";
import { TODO_DETAIL } from "@/pages/home/components/todo-row";
import type { HomeGroup, TodoList } from "@/pages/home/hooks/use-home-data";
import { ROWS_PER_CARD } from "@/pages/home/lib/home-labels";

type ChatsTodoCardProps = {
  group: HomeGroup<TodoList<Conversation>>;
  userId: string | null;
};

export default function ChatsTodoCard({
  group,
  userId,
}: ChatsTodoCardProps): ReactNode {
  const navigate = useNavigate();
  return (
    <TodoCard
      id="chats"
      title="Chats"
      icon={MessageCircle}
      tone="primary"
      phase={group.phase}
      total={group.data?.total ?? 0}
      emptyHint="No chat needs attention. The bot has it."
      seeAllLabel="chats that need attention"
      onSeeAll={() => navigate("/chats")}
      onRetry={group.retry}
      isRetrying={group.isRetrying}
    >
      {group.data?.items.slice(0, ROWS_PER_CARD).map((chat) => (
        <TodoRow
          key={chat.id}
          action={{ to: `/chats/${chat.id}` }}
          title={getChatTitle(chat.guardian, chat.phone_number)}
          titleAside={
            chat.flag_reason && (
              <AttentionBadge reason={FLAG_REASON_LABEL[chat.flag_reason]} />
            )
          }
        >
          {chat.last_message_preview && (
            <span className={TODO_DETAIL}>“{chat.last_message_preview}”</span>
          )}
          <span className="block">
            <ReplyWindowCue
              lastClientMessageAt={chat.last_client_message_at}
              isTakenOverByYou={
                userId !== null && chat.taken_over_by?.id === userId
              }
            />
          </span>
        </TodoRow>
      ))}
    </TodoCard>
  );
}
