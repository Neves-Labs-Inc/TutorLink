import type { ReactNode } from "react";

type ChatThreadProps = {
  conversationId: string;
  container: "pane" | "overlay";
  onClose: () => void;
};

// Ticket 07 fills this: the messages and composer, in the pane or a DetailOverlay.
export function ChatThread({
  conversationId,
  container,
  onClose,
}: ChatThreadProps): ReactNode {
  return (
    <section
      aria-label="Chat"
      data-container={container}
      className="p-4 text-[15px] text-(--tl-muted)"
    >
      <p>Chat {conversationId}</p>
      <button
        type="button"
        onClick={onClose}
        className="mt-2 h-11 cursor-pointer rounded-full px-4 font-medium text-(--tl-primary-ink)"
      >
        Close chat
      </button>
    </section>
  );
}
