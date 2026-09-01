import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { errorDetail } from '@/lib/api'
import { clientListParams, formatPhoneForDisplay } from '@/lib/clients'
import { clientQueries, type Client } from '@/lib/queries/clients'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'

const SEARCH_DEBOUNCE_MS = 300
const checkboxClasses = 'size-4 rounded border-input'

const columns: Column<Client>[] = [
  { id: 'name', header: 'Name', primary: true, cell: (row) => row.name },
  {
    id: 'phone_number',
    header: 'Phone number',
    cell: (row) => formatPhoneForDisplay(row.phone_number),
  },
  { id: 'home_count', header: 'Homes', align: 'end', cell: (row) => row.home_count },
  { id: 'child_count', header: 'Children', align: 'end', cell: (row) => row.child_count },
  {
    id: 'is_active',
    header: 'Status',
    cell: (row) => <StatusBadge status={row.is_active ? 'active' : 'inactive'} />,
  },
]

export const Clients = () => {
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchInput])

  const handleSearchInputChange = (nextSearchInput: string) => {
    setSearchInput(nextSearchInput)
    setPage(1)
  }

  const { data, isPending, isError, error, refetch } = useQuery(
    clientQueries.list(
      clientListParams({
        q: search,
        isActive: !showInactive,
        page,
        pageSize: DEFAULT_PAGE_SIZE,
      }),
    ),
  )

  const clients = data?.items ?? []
  let emptyMessage: string

  if (search.trim() !== '') {
    emptyMessage = 'No clients match that search.'
  } else if (showInactive) {
    emptyMessage = 'No inactive clients.'
  } else {
    emptyMessage = 'No active clients.'
  }

  const handleFilterChange = (nextShowInactive: boolean) => {
    setShowInactive(nextShowInactive)
    setPage(1)
  }

  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">Clients</h1>

      <div className="flex flex-wrap items-end gap-6">
        <div className="w-full max-w-xs space-y-1.5">
          <Label htmlFor="client-search">Search name or phone</Label>
          <Input
            id="client-search"
            type="search"
            value={searchInput}
            onChange={(event) => handleSearchInputChange(event.target.value)}
          />
        </div>
        <Label className="w-fit">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(event) => handleFilterChange(event.target.checked)}
            className={checkboxClasses}
          />
          Show inactive clients
        </Label>
      </div>

      <DataTable
        caption="Clients"
        columns={columns}
        rows={clients}
        rowKey={(row) => row.id}
        status={isPending ? 'pending' : isError ? 'error' : 'ready'}
        errorMessage={errorDetail(error)}
        onRetry={() => refetch()}
        emptyMessage={emptyMessage}
        onRowSelect={(client) => navigate(`/clients/${client.id}`)}
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
