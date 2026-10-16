// Families in the kit's DataTable: who the Guardians are, their
// Children, Homes and the next booking. Whole rows open the family.
import type { ReactNode } from "react";
import { ArchivedBadge, Avatar } from "@/components/kit/components/badges";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column } from "@/components/kit/components/data-table";
import type { FamilyRow } from "@/pages/prototype/accounts-staff/hooks/use-families-list";
import {
  formatShortDate,
  formatWireTime,
} from "@/pages/prototype/accounts-staff/lib/labels";

function getGuardianNames(row: FamilyRow): string {
  const names = row.household.guardians.map((guardian) => guardian.name);
  return names.length > 0 ? names.join(", ") : "No Guardian yet";
}

function getChildNames(row: FamilyRow): string {
  const names = row.household.children.filter((child) => !child.archived).map((child) => child.name.split(" ")[0]);
  return names.length > 0 ? names.join(", ") : "No Children yet";
}

function getNext(row: FamilyRow): string {
  const next = row.nextSession;
  return next ? `${formatShortDate(next.scheduled_date)}, ${formatWireTime(next.start_time)}` : "Nothing booked";
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const COLUMNS: Column<FamilyRow>[] = [
  {
    id: "family",
    header: "Family",
    width: "34%",
    render: (row) => (
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={row.household.guardians[0]?.name ?? row.title} />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold">{row.title}</span>
          <span className="block truncate text-[13px] text-(--tl-muted)">{getGuardianNames(row)}</span>
        </span>
      </span>
    ),
  },
  {
    id: "children",
    header: "Children",
    render: (row) => (
      <span className={row.household.children.length === 0 ? "text-(--tl-muted)" : undefined}>{getChildNames(row)}</span>
    ),
  },
  {
    id: "homes",
    header: "Homes",
    width: "100px",
    isWideOnly: true,
    render: (row) => <span className="tabular-nums">{row.homeCount}</span>,
  },
  {
    id: "next",
    header: "Next booking",
    render: (row) =>
      row.isArchived ? (
        <ArchivedBadge />
      ) : (
        <span className={row.nextSession ? "tabular-nums" : "text-(--tl-muted)"}>{getNext(row)}</span>
      ),
  },
];

type FamiliesTableProps = { rows: FamilyRow[]; onOpen: (row: FamilyRow) => void };

export default function FamiliesTable({ rows, onOpen }: FamiliesTableProps): ReactNode {
  return (
    <DataTable
      caption="Families"
      rows={rows}
      columns={COLUMNS}
      getRowId={(row) => row.key}
      getRowTitle={(row) => row.title}
      isRowMuted={(row) => row.isArchived}
      onOpenRow={onOpen}
      getPhoneRow={(row) => ({
        leading: <Avatar name={row.household.guardians[0]?.name ?? row.title} />,
        title: row.title,
        subtitle: `Children: ${getChildNames(row)}`,
        meta: `${plural(row.household.guardians.length, "Guardian", "Guardians")} · ${plural(row.homeCount, "Home", "Homes")} · Next: ${getNext(row)}`,
        trailing: row.isArchived ? <ArchivedBadge /> : undefined,
      })}
    />
  );
}
