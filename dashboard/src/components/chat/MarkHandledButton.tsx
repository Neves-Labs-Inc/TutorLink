import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { errorDetail } from '@/lib/api'
import { canMarkHandled, isFlagChangedError, markConversationHandled } from '@/lib/chatThread'
import { conversationQueries, type ConversationDetail } from '@/lib/queries/conversations'

export type MarkHandledButtonProps = { conversation: ConversationDetail }

const HANDLE_FALLBACK_ERROR = 'Could not mark this conversation handled.'

export const MarkHandledButton = ({ conversation }: MarkHandledButtonProps) => {
  const queryClient = useQueryClient()

  const handle = useMutation({
    mutationFn: () => markConversationHandled(conversation.id, conversation.flagged_at ?? ''),
    onSuccess: (updated) => {
      queryClient.setQueryData(conversationQueries.detail(conversation.id).queryKey, updated)
      queryClient.invalidateQueries({ queryKey: ['conversations', 'list'] })
    },
    onError: (error) => {
      if (isFlagChangedError(error)) {
        queryClient.invalidateQueries({
          queryKey: conversationQueries.detail(conversation.id).queryKey,
        })
      }
    },
  })

  return canMarkHandled(conversation) ? (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => handle.mutate()}
        disabled={handle.isPending}
      >
        {handle.isPending ? 'Marking…' : 'Mark handled'}
      </Button>
      {handle.isError && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorDetail(handle.error) ?? HANDLE_FALLBACK_ERROR}
        </p>
      )}
    </div>
  ) : null
}
