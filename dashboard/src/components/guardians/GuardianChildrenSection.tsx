import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { AddChildSlideOver } from '@/components/children/AddChildSlideOver'
import { DataTable, type Column } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { errorDetail } from '@/lib/api'
import { formatDateOfBirth } from '@/lib/children/children'
import { guardianQueries, type GuardianChild } from '@/lib/queries/guardians'

type GuardianChildrenSectionProps = { guardianId: string }

const columns = (today: Date): Column<GuardianChild>[] => [
  { id: 'name', header: 'Name', primary: true, cell: (child) => child.name },
  {
    id: 'dob',
    header: 'Date of birth',
    cell: (child) => formatDateOfBirth(child.date_of_birth, today),
  },
  { id: 'grade', header: 'Grade', cell: (child) => `Grade ${child.grade_level}` },
  { id: 'school', header: 'School', cell: (child) => child.school_name },
  {
    id: 'notes',
    header: 'Notes',
    cell: (child) => (
      <span
        tabIndex={0}
        title={child.notes ?? undefined}
        className="block max-w-[16rem] truncate"
      >
        {child.notes ?? '—'}
      </span>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    cell: (child) => (child.is_active ? null : <StatusBadge status="inactive" />),
  },
]

export const GuardianChildrenSection = ({ guardianId }: GuardianChildrenSectionProps) => {
  const navigate = useNavigate()
  const { data, isPending, isError, error, refetch } = useQuery(guardianQueries.detail(guardianId))
  const [addOpen, setAddOpen] = useState(false)
  const fixedGuardian = useMemo(
    () => (data ? { id: guardianId, name: data.name } : undefined),
    [guardianId, data],
  )

  return (
    <section aria-labelledby="children-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="children-heading" className="font-heading text-lg font-semibold tracking-tight">
          Children
        </h2>
        <Button type="button" size="sm" onClick={() => setAddOpen(true)}>
          Add child
        </Button>
      </div>
      <DataTable
        caption="Children linked to this guardian"
        columns={columns(new Date())}
        rows={data?.children ?? []}
        rowKey={(child) => child.id}
        status={isPending ? 'pending' : isError ? 'error' : 'ready'}
        errorMessage={errorDetail(error)}
        onRetry={() => refetch()}
        emptyMessage="No children are linked to this guardian."
        onRowSelect={(child) => navigate(`/children/${child.id}`)}
      />
      {fixedGuardian && (
        <AddChildSlideOver
          open={addOpen}
          onOpenChange={setAddOpen}
          fixedGuardian={fixedGuardian}
          onCreated={() => setAddOpen(false)}
        />
      )}
    </section>
  )
}
