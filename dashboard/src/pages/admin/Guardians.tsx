import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { AddGuardianSlideOver } from '@/components/guardians/AddGuardianSlideOver'
import { Pager } from '@/components/shared/Pager'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorDetail } from '@/lib/api'
import { formatPhoneForDisplay } from '@/lib/guardians/guardians'
import { householdCountLabel, householdListParams } from '@/lib/households/households'
import { householdQueries, type Household } from '@/lib/queries/households'
import { DEFAULT_PAGE_SIZE } from '@/lib/queries/page'

const SEARCH_DEBOUNCE_MS = 300
const LOADING_CARDS = [0, 1, 2, 3, 4, 5]
const ERROR_FALLBACK = 'Something went wrong. Please try again.'
const cardGridClasses = 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'

export const Guardians = () => {
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [searchInput])

  const handleSearchInputChange = (nextSearchInput: string) => {
    setSearchInput(nextSearchInput)
    setPage(1)
  }

  const { data, isPending, isError, error, refetch } = useQuery(
    householdQueries.list(householdListParams(search, page, DEFAULT_PAGE_SIZE)),
  )

  const households = data?.items ?? []
  const emptyMessage =
    search.trim() !== '' ? 'No guardians match that search.' : 'No guardians yet.'

  let content: ReactNode

  if (isPending) {
    content = (
      <div className={cardGridClasses}>
        {LOADING_CARDS.map((card) => (
          <Card key={card}>
            <CardContent aria-busy="true" className="space-y-3">
              <div className="h-8 animate-pulse rounded-lg bg-muted" />
              <div className="h-8 animate-pulse rounded-lg bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  } else if (isError) {
    content = (
      <Card>
        <CardContent className="space-y-4">
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(error) ?? ERROR_FALLBACK}
          </p>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  } else if (households.length === 0) {
    content = (
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </CardContent>
      </Card>
    )
  } else {
    content = (
      <div className={cardGridClasses}>
        {households.map((household) => (
          <HouseholdCard key={household.key} household={household} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Guardians</h1>
        <Button type="button" onClick={() => setAddOpen(true)}>
          Add guardian
        </Button>
      </div>

      <div className="w-full max-w-xs space-y-1.5">
        <Label htmlFor="guardian-search">Search guardians, children or phone numbers</Label>
        <Input
          id="guardian-search"
          type="search"
          value={searchInput}
          onChange={(event) => handleSearchInputChange(event.target.value)}
        />
      </div>

      {data && (
        <p className="text-sm text-muted-foreground">{householdCountLabel(data.total)}</p>
      )}

      {content}

      {data && (
        <Pager
          page={page}
          pageSize={data.page_size}
          total={data.total}
          onPageChange={setPage}
          disabled={isPending}
        />
      )}

      <AddGuardianSlideOver
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={(guardian) => navigate(`/guardians/${guardian.id}`)}
      />
    </div>
  )
}

type HouseholdCardProps = { household: Household }

const HouseholdCard = ({ household }: HouseholdCardProps) => (
  <Card>
    <CardContent className="space-y-4">
      <div className="space-y-2">
        <h2 className="text-xs font-medium text-muted-foreground">Guardians</h2>
        <ul className="space-y-2">
          {household.guardians.map((guardian) => (
            <li key={guardian.id}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/guardians/${guardian.id}`}
                  className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {guardian.name}
                </Link>
                {!guardian.is_active && <StatusBadge status="inactive" />}
              </div>
              <p className="text-sm text-muted-foreground">
                {formatPhoneForDisplay(guardian.phone_number)}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h2 className="text-xs font-medium text-muted-foreground">Children</h2>
        {household.children.length === 0 ? (
          <p className="text-sm text-muted-foreground">No children</p>
        ) : (
          <ul className="space-y-2">
            {household.children.map((child) => (
              <li key={child.id} className="flex flex-wrap items-center gap-2">
                <Link
                  to={`/children/${child.id}`}
                  className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {child.name}
                </Link>
                <span className="text-sm text-muted-foreground">Grade {child.grade_level}</span>
                {!child.is_active && <StatusBadge status="inactive" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </CardContent>
  </Card>
)
