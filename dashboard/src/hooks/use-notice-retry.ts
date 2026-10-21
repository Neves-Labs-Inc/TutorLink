// Retry for a failed Takeover or Transfer notice. A refusal (the window
// closed meanwhile) refetches the detail, which takes Retry away.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getDetailKey, getMessagesKeyPrefix } from "@/hooks/use-chat-thread";
import { applyMessageToPages } from "@/lib/chatThread";
import { retryNotice } from "@/lib/queries/conversations";

export type NoticeRetry = {
  pendingId: string | null;
  failedId: string | null;
  retry: (messageId: string) => void;
};

export function useNoticeRetry(conversationId: string): NoticeRetry {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (messageId: string) => retryNotice(conversationId, messageId),
    onSuccess: (updated) =>
      applyMessageToPages(
        queryClient,
        getMessagesKeyPrefix(conversationId),
        updated,
      ),
    onError: (error, messageId) => {
      console.warn("chat thread: notice retry refused", {
        conversationId,
        messageId,
        error,
      });
      return queryClient.invalidateQueries({
        queryKey: getDetailKey(conversationId),
        exact: true,
      });
    },
  });

  return {
    pendingId: mutation.isPending ? mutation.variables : null,
    failedId: mutation.isError ? mutation.variables : null,
    retry: mutation.mutate,
  };
}
