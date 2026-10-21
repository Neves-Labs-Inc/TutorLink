// Families in the kit's DataTable: who the Guardians are, their live
// Children, Homes and the next booking. Whole rows open the family.
import type { ReactNode } from "react";
import { ArchivedBadge, Avatar } from "@/components/kit/components/badges";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column } from "@/components/kit/components/data-table";
import { formatClock, formatDay, pluralize } from "@/components/kit/format";
import type { HouseholdRead } from "@/types/families";

const FAMILY_COLUMN_WIDTH = "34%";
const HOMES_COLUMN_WIDTH = "100px";
const NO_CHILDREN = "No Children yet";
const NOTHING_BOOKED = "Nothing booked";

function getGuardianNames(family: HouseholdRead): string {
  const names = family.guardians.map((guardian) => guardian.name);
  return names.length > 0 ? names.join(", ") : "No Guardian yet";
}

function getChildNames(family: HouseholdRead): string | null {
  const names = family.children
    .filter((child) => !child.archived)
    .map((child) => child.name.split(" ")[0]);
  return names.length > 0 ? names.join(", ") : null;
}

function getHomeCount(family: HouseholdRead): number {
  return family.homes.filter((home) => !home.archived).length;
}

function getNextBooking(family: HouseholdRead): string | null {
  const next = family.next_booking;
  if (!next) return null;

  const day = formatDay(next.scheduled_date, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${day}, ${formatClock(next.start_time)}`;
}

function renderAvatar(family: HouseholdRead): ReactNode {
  return <Avatar name={family.guardians[0]?.name ?? family.name} />;
}

const COLUMNS: Column<HouseholdRead>[] = [
  {
    id: "family",
    header: "Family",
    width: FAMILY_COLUMN_WIDTH,
    render: (family) => (
      <span className="flex min-w-0 items-center gap-3">
        {renderAvatar(family)}
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold">{family.name}</span>
          <span className="block truncate text-[13px] text-(--tl-muted)">
            {getGuardianNames(family)}
          </span>
        </span>
      </span>
    ),
  },
  {
    id: "children",
    header: "Children",
    render: (family) => {
      const names = getChildNames(family);
      return <span className={names ? undefined : "text-(--tl-muted)"}>{names ?? NO_CHILDREN}</span>;
    },
  },
  {
    id: "homes",
    header: "Homes",
    width: HOMES_COLUMN_WIDTH,
    render: (family) => <span className="tabular-nums">{getHomeCount(family)}</span>,
  },
  {
    id: "next",
    header: "Next booking",
    render: (family) => {
      if (family.archived) return <ArchivedBadge />;

      const next = getNextBooking(family);
      return (
        <span className={next ? "tabular-nums" : "text-(--tl-muted)"}>
          {next ?? NOTHING_BOOKED}
        </span>
      );
    },
  },
];

type FamiliesTableProps = {
  families: HouseholdRead[];
  onOpen: (family: HouseholdRead) => void;
};

export default function FamiliesTable({ families, onOpen }: FamiliesTableProps): ReactNode {
  return (
    <DataTable
      caption="Families"
      rows={families}
      columns={COLUMNS}
      getRowId={(family) => family.key}
      getRowTitle={(family) => family.name}
      isRowMuted={(family) => family.archived}
      onOpenRow={onOpen}
      getPhoneRow={(family) => ({
        leading: renderAvatar(family),
        title: family.name,
        subtitle: `Children: ${getChildNames(family) ?? NO_CHILDREN}`,
        meta: `${pluralize(family.guardians.length, "Guardian", "Guardians")} · ${pluralize(getHomeCount(family), "Home", "Homes")} · Next: ${getNextBooking(family) ?? NOTHING_BOOKED}`,
        trailing: family.archived ? <ArchivedBadge /> : undefined,
      })}
    />
  );
}
