import { useQuery } from '@tanstack/react-query'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { errorDetail } from '@/lib/api'
import { clientQueries, type ClientChild } from '@/lib/queries/clients'

type ChildrenSectionProps = { clientId: string }

// Deliberately no expansion (amendment A-3): nothing serves a child's own guardians and homes,
// and the guardian's homes are not a substitute — a child of separated guardians has different
// ones, so borrowing them would show an admin the wrong address and access code.
const COLUMNS: Column<ClientChild>[] = [
  { id: 'name', header: 'Name', primary: true, cell: (child) => child.name },
  { id: 'age', header: 'Age', cell: (child) => child.age },
  { id: 'grade', header: 'Grade', cell: (child) => `Grade ${child.grade_level}` },
  { id: 'school', header: 'School', cell: (child) => child.school_name },
]

export const ChildrenSection = ({ clientId }: ChildrenSectionProps) => {
  const { data, isPending, isError, error, refetch } = useQuery(clientQueries.detail(clientId))

  return (
    <section aria-labelledby="children-heading" className="space-y-3">
      <h2 id="children-heading" className="font-heading text-lg font-semibold tracking-tight">
        Children
      </h2>
      <DataTable
        caption="Children linked to this guardian"
        columns={COLUMNS}
        rows={data?.children ?? []}
        rowKey={(child) => child.id}
        status={isPending ? 'pending' : isError ? 'error' : 'ready'}
        errorMessage={errorDetail(error)}
        onRetry={() => refetch()}
        emptyMessage="No children are linked to this guardian."
      />
    </section>
  )
}
