import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { ConversationList } from '@/components/chat/ConversationList'
import { Pager } from '@/components/shared/Pager'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useConversationStream } from '@/hooks/use-conversation-stream/useConversationStream'
import { errorDetail } from '@/lib/api'
import { conversationListParams, EMPTY_FILTERS, type ConversationFilterState } from '@/lib/chatList'
import { conversationQueries } from '@/lib/queries/conversations'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'

const SEARCH_DEBOUNCE_MS = 300
const checkboxClasses = 'size-4 rounded border-input'

export const Chats = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState('')
  const [filters, setFilters] = useState<ConversationFilterState>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(
      () => setFilters((current) => ({ ...current, q: searchInput })),
      SEARCH_DEBOUNCE_MS,
    )

    return () => clearTimeout(timer)
  }, [searchInput])

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: ['conversations', 'list'] })

  useConversationStream({
    onConversationUpdated: invalidateList,
    onMessageCreated: invalidateList,
  })

  const { data, isPending, isError, error, refetch } = useQuery(
    conversationQueries.list(conversationListParams(filters, page, DEFAULT_PAGE_SIZE)),
  )

  const applyFilters = (next: ConversationFilterState) => {
    setFilters(next)
    setPage(1)
  }

  const handleSearchInputChange = (nextSearchInput: string) => {
    setSearchInput(nextSearchInput)
    setPage(1)
  }

  let emptyMessage: string

  if (filters.q.trim() !== '') {
    emptyMessage = 'No conversations match that search.'
  } else if (filters.flagged) {
    emptyMessage = 'No flagged conversations.'
  } else if (filters.unread) {
    emptyMessage = 'No unread conversations.'
  } else {
    emptyMessage = 'No conversations yet.'
  }

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Chats</h1>

      <div className="flex flex-wrap items-end gap-6">
        <div className="w-full max-w-xs space-y-1.5">
          <Label htmlFor="chat-search">Search name or phone</Label>
          <Input
            id="chat-search"
            type="search"
            value={searchInput}
            onChange={(event) => handleSearchInputChange(event.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="chat-status-filter">Status</Label>
          <Select
            id="chat-status-filter"
            value={filters.status}
            onChange={(event) =>
              applyFilters({
                ...filters,
                status: event.target.value as ConversationFilterState['status'],
              })
            }
          >
            <option value="">All</option>
            <option value="bot">Bot</option>
            <option value="human">Human</option>
          </Select>
        </div>

        <Label className="w-fit">
          <input
            type="checkbox"
            checked={filters.unread}
            onChange={(event) => applyFilters({ ...filters, unread: event.target.checked })}
            className={checkboxClasses}
          />
          Unread only
        </Label>

        <Label className="w-fit">
          <input
            type="checkbox"
            checked={filters.flagged}
            onChange={(event) => applyFilters({ ...filters, flagged: event.target.checked })}
            className={checkboxClasses}
          />
          Flagged only
        </Label>
      </div>

      <ConversationList
        conversations={data?.items ?? []}
        status={isPending ? 'pending' : isError ? 'error' : 'ready'}
        errorMessage={errorDetail(error)}
        onRetry={() => refetch()}
        emptyMessage={emptyMessage}
        onSelect={(conversation) => navigate(`/chats/${conversation.id}`)}
        now={new Date()}
      />

      {data && (
        <Pager
          page={page}
          pageSize={data.page_size}
          total={data.total}
          onPageChange={setPage}
          disabled={isPending}
        />
      )}
    </div>
  )
}
