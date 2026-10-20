import type { ReactNode } from "react";

type ConversationListProps = {
  openId: string | null;
  onOpen: (id: string) => void;
};

// Ticket 06 fills this: the chat rows. onOpen navigates to /chats/:id.
export function ConversationList({
  openId,
  onOpen,
}: ConversationListProps): ReactNode {
  return (
    <div className="p-4 text-[15px] text-(--tl-muted)">
      <p>Conversation list</p>
      <button
        type="button"
        aria-pressed={openId === "sample"}
        onClick={() => onOpen("sample")}
        className="mt-2 h-11 cursor-pointer rounded-full px-4 font-medium text-(--tl-primary-ink)"
      >
        Open sample chat
      </button>
    </div>
  );
}
