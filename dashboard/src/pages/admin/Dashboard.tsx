import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorDetail } from '@/lib/api'
import {
  hasDateRolledOver,
  queriedDateLabel,
  tableStatus,
  todaySessionsCaption,
  todaySessionsParams,
  upcomingWeekLabel,
} from '@/lib/dashboard/dashboard'
import { formatIsoDate, formatTime, todayLocalIso } from '@/lib/dates/dates'
import { bookingQueries, type Booking } from '@/lib/queries/bookings'
import { statsQueries } from '@/lib/queries/stats'

type StatWidgetProps = {
  label: string
  value: number
  detail: string
}

const FALLBACK_ERROR = 'Something went wrong. Please try again.'
const ROLLOVER_CHECK_MS = 60_000
const WIDGET_SKELETONS = [0, 1, 2, 3]

const widgetGridClasses = 'grid gap-4 sm:grid-cols-1 lg:grid-cols-2'

const STATUS_COLUMN: Column<Booking> = {
  id: 'status',
  header: 'Status',
  align: 'end',
  cell: (row) => <StatusBadge status={row.status} />,
}

const TODAY_COLUMNS: Column<Booking>[] = [
  {
    id: 'time',
    header: 'Time',
    primary: true,
    cell: (row) => `${formatTime(row.start_time)} – ${formatTime(row.end_time)}`,
  },
  { id: 'child', header: 'Child', cell: (row) => row.child.name },
  { id: 'tutor', header: 'Tutor', cell: (row) => row.tutor.name },
  { id: 'subject', header: 'Subject', cell: (row) => row.subject.name },
  STATUS_COLUMN,
]

const RECENT_COLUMNS: Column<Booking>[] = [
  { id: 'child', header: 'Child', primary: true, cell: (row) => row.child.name },
  { id: 'tutor', header: 'Tutor', cell: (row) => row.tutor.name },
  { id: 'subject', header: 'Subject', cell: (row) => row.subject.name },
  { id: 'date', header: 'Date', cell: (row) => formatIsoDate(row.scheduled_date) },
  STATUS_COLUMN,
]

export const Dashboard = () => {
  const [queriedDate, setQueriedDate] = useState(() => todayLocalIso(new Date()))
  const stats = useQuery(statsQueries.overview(queriedDate))
  const todaySessions = useQuery(bookingQueries.list(todaySessionsParams(queriedDate)))
  let widgets: ReactNode

  useEffect(() => {
    const timer = setInterval(() => {
      setQueriedDate((current) => {
        const now = new Date()

        return hasDateRolledOver(current, now) ? todayLocalIso(now) : current
      })
    }, ROLLOVER_CHECK_MS)

    return () => clearInterval(timer)
  }, [])

  if (stats.isPending) {
    widgets = (
      <div className={widgetGridClasses}>
        {WIDGET_SKELETONS.map((slot) => (
          <Card key={slot}>
            <CardContent aria-busy="true" className="space-y-3">
              <div className="h-4 w-24 animate-pulse rounded-lg bg-muted" />
              <div className="h-8 w-16 animate-pulse rounded-lg bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  } else if (stats.isError) {
    widgets = (
      <Card>
        <CardContent className="space-y-4">
          <p role="alert" className="text-sm font-medium text-destructive">
            {errorDetail(stats.error) ?? FALLBACK_ERROR}
          </p>
          <Button type="button" variant="outline" onClick={() => stats.refetch()}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  } else {
    widgets = (
      <div className={widgetGridClasses}>
        <StatWidget
          label="Today's sessions"
          value={stats.data.today_session_count}
          detail={`Live on ${formatIsoDate(stats.data.date)}`}
        />
        <StatWidget
          label="Upcoming this week"
          value={stats.data.upcoming_week_session_count}
          detail={upcomingWeekLabel(stats.data.date, stats.data.week_end)}
        />
        {/* <StatWidget
          label="Active tutors"
          value={stats.data.active_tutor_count}
          detail="Tutors currently active"
        />
        <StatWidget
          label="Active guardians"
          value={stats.data.active_client_count}
          detail="Guardians currently active"
        /> */}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          {queriedDateLabel(queriedDate)} — this device's local date
        </p>
      </div>
      {widgets}
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-medium tracking-tight">Today's sessions</h2>
        <DataTable
          caption={todaySessionsCaption(queriedDate, todaySessions.data?.total ?? 0)}
          columns={TODAY_COLUMNS}
          rows={todaySessions.data?.items ?? []}
          rowKey={(row) => row.id}
          status={tableStatus(todaySessions.isPending, todaySessions.isError)}
          errorMessage={errorDetail(todaySessions.error)}
          onRetry={() => todaySessions.refetch()}
          emptyMessage={`No live sessions on ${formatIsoDate(queriedDate)}.`}
        />
      </section>
      <section className="space-y-3">
        <h2 className="font-heading text-lg font-medium tracking-tight">Recent bookings</h2>
        <DataTable
          caption="The five most recently created bookings"
          columns={RECENT_COLUMNS}
          rows={stats.data?.recent_bookings ?? []}
          rowKey={(row) => row.id}
          status={tableStatus(stats.isPending, stats.isError)}
          errorMessage={errorDetail(stats.error)}
          onRetry={() => stats.refetch()}
          emptyMessage="No bookings have been created yet."
        />
      </section>
    </div>
  )
}

const StatWidget = ({ label, value, detail }: StatWidgetProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      <CardDescription>{detail}</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="font-heading text-3xl font-semibold tabular-nums text-foreground">{value}</p>
    </CardContent>
  </Card>
)
