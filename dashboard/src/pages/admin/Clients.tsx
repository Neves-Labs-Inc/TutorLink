import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { Pager } from '@/components/shared/Pager'
import { SlideOver } from '@/components/shared/SlideOver'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { errorDetail } from '@/lib/api'
import {
  clientFormErrors,
  clientListParams,
  createClientPayload,
  formatPhoneForDisplay,
  type ClientDraft,
} from '@/lib/clients/clients'
import { clientQueries, createClient, type Client } from '@/lib/queries/clients'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'

const SEARCH_DEBOUNCE_MS = 300
const checkboxClasses = 'size-4 rounded border-input'
const EMPTY_HOME = { label: '', address: '', accessCode: '' }
const EMPTY_DRAFT: ClientDraft = { name: '', phoneNumber: '', home: EMPTY_HOME }
const SAVE_FALLBACK_ERROR = 'Something went wrong. Please try again.'

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
  const queryClient = useQueryClient()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState<ClientDraft>(EMPTY_DRAFT)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

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

  const createMutation = useMutation({
    mutationFn: createClient,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
  })

  const closeForm = () => {
    setFormOpen(false)
    setDraft(EMPTY_DRAFT)
    setValidationErrors([])
    createMutation.reset()
  }

  const openForm = () => {
    setDraft(EMPTY_DRAFT)
    setValidationErrors([])
    setFormOpen(true)
  }

  const handleSubmit = () => {
    const errors = clientFormErrors(draft)

    if (errors.length > 0) {
      setValidationErrors(errors)
    } else {
      setValidationErrors([])
      createMutation.mutate(createClientPayload(draft), {
        onSuccess: (client) => {
          closeForm()
          navigate(`/clients/${client.id}`)
        },
      })
    }
  }

  const saveErrorMessage = createMutation.isError
    ? (errorDetail(createMutation.error) ?? SAVE_FALLBACK_ERROR)
    : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Clients</h1>
        <Button type="button" onClick={openForm}>
          Add Client
        </Button>
      </div>

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

      <SlideOver
        open={formOpen}
        onOpenChange={(open) => {
          if (!open && !createMutation.isPending) closeForm()
        }}
        title="Add client"
        footer={
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={closeForm}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        }
      >
        <ClientForm
          draft={draft}
          onChange={setDraft}
          validationErrors={validationErrors}
          saveErrorMessage={saveErrorMessage}
        />
      </SlideOver>
    </div>
  )
}

type ClientFormProps = {
  draft: ClientDraft
  onChange: (draft: ClientDraft) => void
  validationErrors: string[]
  saveErrorMessage: string | null
}

const ClientForm = ({ draft, onChange, validationErrors, saveErrorMessage }: ClientFormProps) => {
  let content: ReactNode = null

  if (validationErrors.length > 0 || saveErrorMessage !== null) {
    content = (
      <ul role="alert" className="space-y-1 text-sm font-medium text-destructive">
        {validationErrors.map((message) => (
          <li key={message}>{message}</li>
        ))}
        {saveErrorMessage !== null && <li>{saveErrorMessage}</li>}
      </ul>
    )
  }

  return (
    <div className="space-y-4">
      {content}

      <div className="space-y-1.5">
        <Label htmlFor="client-name">Name</Label>
        <Input
          id="client-name"
          value={draft.name}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="client-phone">Phone number</Label>
        <Input
          id="client-phone"
          value={draft.phoneNumber}
          onChange={(event) => onChange({ ...draft, phoneNumber: event.target.value })}
        />
      </div>

      <div className="space-y-4">
        <Label>Home (optional)</Label>

        <div className="space-y-1.5">
          <Label htmlFor="client-home-label">Label</Label>
          <Input
            id="client-home-label"
            value={draft.home.label}
            onChange={(event) =>
              onChange({ ...draft, home: { ...draft.home, label: event.target.value } })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="client-home-address">Address</Label>
          <Input
            id="client-home-address"
            value={draft.home.address}
            onChange={(event) =>
              onChange({ ...draft, home: { ...draft.home, address: event.target.value } })
            }
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="client-home-access-code">Access code</Label>
          <Input
            id="client-home-access-code"
            value={draft.home.accessCode}
            onChange={(event) =>
              onChange({ ...draft, home: { ...draft.home, accessCode: event.target.value } })
            }
          />
        </div>
      </div>
    </div>
  )
}
