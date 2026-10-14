import { beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'

import { DataTable, type Column } from '@/components/shared/DataTable'
import { StatusBadge } from '@/components/shared/StatusBadge'
import { ADMIN_CONTENT_WIDTHS, findBrokenWords } from '@/test/brokenWords'
import { settleLayout } from '@/test/settleLayout'

const DESKTOP_WIDTH = 1280
const VIEWPORT_HEIGHT = 800

type Row = { id: string; values: string[]; status: string }

type Fixture = { name: string; headers: string[]; rows: Row[] }

// Dense, ordinary rows shaped like each admin list; no value is longer than a normal word.
const FIXTURES: Fixture[] = [
  {
    name: 'Tutors',
    headers: ['Name', 'Email', 'Phone', 'Subjects'],
    rows: [
      {
        id: 't1',
        values: ['Ana Souza', 'carla.mendes.oliveira@example.com', '+5511999990001', 'Mathematics, Physics'],
        status: 'active',
      },
    ],
  },
  {
    name: 'Bookings',
    headers: ['Date', 'Time', 'Child', 'Staff', 'Location', 'Subject'],
    rows: [
      {
        id: 'b1',
        values: ['12 Oct 2026', '3:00 PM – 4:00 PM', 'Lucas Souza', 'Fernanda Albuquerque', 'Online', 'Mathematics'],
        status: 'scheduled',
      },
    ],
  },
  {
    name: 'Users',
    headers: ['Display name', 'Email', 'Role'],
    rows: [
      { id: 'u1', values: ['Maria Fernanda Souza', 'maria.souza@example.com', 'Admin'], status: 'active' },
      { id: 'u2', values: ['Bruno Lima', 'bruno@example.com', 'Ordinary Tutor'], status: 'active' },
    ],
  },
  {
    name: 'Reminders',
    headers: ['Guardian', 'Children', 'Language', 'Detail', 'Sent at'],
    rows: [
      {
        id: 'r1',
        values: [
          'Maria Fernanda Souza',
          'Lucas Souza, Ana Souza',
          'Portuguese',
          'Error 63049: Meta chose not to deliver this message.',
          'Mon 12 Oct, 9:00 AM',
        ],
        status: 'delivered',
      },
    ],
  },
]

const columnsFor = (fixture: Fixture): Column<Row>[] => [
  ...fixture.headers.map((header, index) => ({
    id: header,
    header,
    primary: index === 0,
    cell: (row: Row) => row.values[index],
  })),
  { id: 'status', header: 'Status', cell: (row: Row) => <StatusBadge status={row.status} /> },
]

describe('DataTable ordinary rows', () => {
  beforeEach(async () => {
    await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT)
  })

  for (const fixture of FIXTURES) {
    for (const width of ADMIN_CONTENT_WIDTHS) {
      it(`keeps every ${fixture.name} word whole in a ${width}px container`, async () => {
        await render(
          <div style={{ width }}>
            <DataTable
              caption={fixture.name}
              columns={columnsFor(fixture)}
              rows={fixture.rows}
              rowKey={(row) => row.id}
              status="ready"
              emptyMessage="Nothing here."
            />
          </div>,
        )
        await settleLayout()

        expect(findBrokenWords(Array.from(document.querySelectorAll<HTMLElement>('td')))).toEqual([])
      })
    }
  }
})
