// Staff in the kit's DataTable: Name · Role · Subjects · Sign-in state,
// with a Time off pending marker on the row. Email and phone live in
// details. Whole rows open details; no row actions.
import type { ReactNode } from "react";
import { Plane } from "lucide-react";
import {
  ArchivedBadge,
  Avatar,
  Badge,
  SignInBadge,
} from "@/components/kit/components/badges";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column } from "@/components/kit/components/data-table";
import {
  getRoleLabel,
  getSignInLabel,
} from "@/pages/prototype/accounts-staff/lib/labels";
import type { StaffRead } from "@/pages/prototype/accounts-staff/types/api";

export type StaffRow = StaffRead & { hasPendingTimeOff: boolean };

function getSubjects(staff: StaffRead): string {
  if (staff.role === "admin") return "—";
  return staff.subjects.length > 0 ? staff.subjects.map((s) => s.name).join(", ") : "None yet";
}

function getStateBadge(staff: StaffRead): ReactNode {
  return staff.archived ? <ArchivedBadge /> : <SignInBadge state={getSignInLabel(staff.sign_in_state)} />;
}

function TimeOffMarker(): ReactNode {
  return (
    <Badge tone="yellow" icon={Plane}>
      Time off pending
    </Badge>
  );
}

const COLUMNS: Column<StaffRow>[] = [
  {
    id: "name",
    header: "Name",
    width: "34%",
    render: (staff) => (
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={staff.name} />
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[15px] font-semibold">{staff.name}</span>
          {staff.hasPendingTimeOff && <TimeOffMarker />}
        </span>
      </span>
    ),
  },
  { id: "role", header: "Role", render: (staff) => getRoleLabel(staff.role) },
  {
    id: "subjects",
    header: "Subjects",
    render: (staff) => (
      <span className={staff.subjects.length === 0 ? "text-(--tl-muted)" : undefined}>{getSubjects(staff)}</span>
    ),
  },
  { id: "signin", header: "Sign-in state", render: getStateBadge },
];

type StaffTableProps = { rows: StaffRow[]; onOpen: (row: StaffRow) => void };

export default function StaffTable({ rows, onOpen }: StaffTableProps): ReactNode {
  return (
    <DataTable
      caption="Staff"
      rows={rows}
      columns={COLUMNS}
      getRowId={(staff) => staff.id}
      getRowTitle={(staff) => staff.name}
      isRowMuted={(staff) => staff.archived}
      onOpenRow={onOpen}
      getPhoneRow={(staff) => ({
        leading: <Avatar name={staff.name} />,
        title: staff.name,
        subtitle: staff.role === "admin" ? "Admin" : `${getRoleLabel(staff.role)} · ${getSubjects(staff)}`,
        meta: staff.hasPendingTimeOff ? "Time off pending" : undefined,
        trailing: getStateBadge(staff),
      })}
    />
  );
}
