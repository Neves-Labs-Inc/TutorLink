// The Guardian language picker in a chat header: optimistic, reverting
// with an inline alert when the change fails.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDetailKey } from "@/hooks/use-chat-thread";
import { updateConversationLanguage } from "@/lib/queries/conversations";
import type { ConversationDetail } from "@/lib/queries/conversations";
import type { Language } from "@/lib/reminders/reminders";

type ChatLanguage = {
  value: Language | null;
  hasFailed: boolean;
  change: (language: Language | null) => void;
};

export function useChatLanguage(conversation: ConversationDetail): ChatLanguage {
  const queryClient = useQueryClient();
  // Cleared only by the next successful change, as the design asks.
  const [hasFailed, setHasFailed] = useState(false);
  const mutation = useMutation({
    mutationFn: (language: Language | null) =>
      updateConversationLanguage(conversation.id, language),
    onSuccess: (updated) => {
      queryClient.setQueryData(getDetailKey(conversation.id), updated);
      setHasFailed(false);
    },
    onError: (error) => {
      console.warn("chat thread: language change failed", {
        conversationId: conversation.id,
        error,
      });
      setHasFailed(true);
    },
  });

  return {
    value: mutation.isPending
      ? (mutation.variables ?? null)
      : conversation.language,
    hasFailed,
    change: mutation.mutate,
  };
}
