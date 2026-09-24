import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { errorDetail } from '@/lib/api'
import {
  approveReactivation,
  conversationQueries,
  denyReactivation,
  type ConversationDetail,
  type ReactivationRequest,
} from '@/lib/queries/conversations'

export type ReactivationRequestPanelProps = {
  conversationId: string
  request: ReactivationRequest
}

const APPROVE_FALLBACK_ERROR = 'Could not reactivate this child.'
const DENY_FALLBACK_ERROR = 'Could not deny this request.'

export const ReactivationRequestPanel = ({
  conversationId,
  request,
}: ReactivationRequestPanelProps) => {
  const queryClient = useQueryClient()
  const [openDialog, setOpenDialog] = useState<'approve' | 'deny' | null>(null)

  const detailKey = conversationQueries.detail(conversationId).queryKey

  const invalidateRelated = () => {
    queryClient.invalidateQueries({ queryKey: ['conversations', 'list'] })
    queryClient.invalidateQueries({ queryKey: ['children'] })
    queryClient.invalidateQueries({ queryKey: ['guardians'] })
    queryClient.invalidateQueries({ queryKey: ['households'] })
  }

  const decided = (updated: ConversationDetail) => {
    setOpenDialog(null)
    queryClient.setQueryData(detailKey, updated)
    invalidateRelated()
  }

  const approve = useMutation({
    mutationFn: () => approveReactivation(conversationId),
    onSuccess: decided,
  })

  const deny = useMutation({
    mutationFn: () => denyReactivation(conversationId),
    onSuccess: decided,
  })

  const changeDialog = (next: 'approve' | 'deny' | null) => {
    if (next === null && (approve.isError || deny.isError)) {
      approve.reset()
      deny.reset()
      queryClient.invalidateQueries({ queryKey: detailKey, exact: true })
      invalidateRelated()
    }
    setOpenDialog(next)
  }

  const { name, id, is_active: isActive } = request.child

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/50 p-3">
      <p className="text-sm text-foreground">
        Reactivation requested for{' '}
        <Link
          to={`/children/${id}`}
          className="font-medium underline-offset-2 hover:underline"
        >
          {name}
        </Link>
        {isActive && <span className="text-muted-foreground"> (already active)</span>}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => changeDialog('approve')}>
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => changeDialog('deny')}
        >
          Deny
        </Button>
      </div>

      <ConfirmDialog
        open={openDialog === 'approve'}
        onOpenChange={(open) => changeDialog(open ? 'approve' : null)}
        title="Reactivate child"
        body={`Reactivate ${name}?`}
        confirmLabel="Approve"
        pending={approve.isPending}
        errorMessage={approve.isError ? (errorDetail(approve.error) ?? APPROVE_FALLBACK_ERROR) : null}
        onConfirm={() => approve.mutate()}
      />

      <ConfirmDialog
        open={openDialog === 'deny'}
        onOpenChange={(open) => changeDialog(open ? 'deny' : null)}
        title="Deny reactivation"
        body={`Deny the request? ${name} stays inactive. The guardian is not notified.`}
        confirmLabel="Deny"
        destructive
        pending={deny.isPending}
        errorMessage={deny.isError ? (errorDetail(deny.error) ?? DENY_FALLBACK_ERROR) : null}
        onConfirm={() => deny.mutate()}
      />
    </div>
  )
}
