// Staff in the kit's DataTable: Name · Role · Subjects · Sign-in state,
// with a "Time off pending" marker on the row. Email and phone live in
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
import type { Column, PhoneRow } from "@/components/kit/components/data-table";
import type { StaffRead } from "@/lib/queries/staff";
import { roleLabel } from "@/lib/users/users";
import {
  getSignInLabel,
  getSubjectsText,
} from "@/pages/staff/lib/staff-labels";

const TIME_OFF_PENDING = "Time off pending";

function getStateBadge(staff: StaffRead): ReactNode {
  return staff.archived ? (
    <ArchivedBadge />
  ) : (
    <SignInBadge state={getSignInLabel(staff.sign_in_state)} />
  );
}

const COLUMNS: Column<StaffRead>[] = [
  {
    id: "name",
    header: "Name",
    width: "34%",
    render: (staff) => (
      <span className="flex min-w-0 items-center gap-3">
        <Avatar name={staff.name} />
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[15px] font-semibold">
            {staff.name}
          </span>
          {staff.has_pending_time_off && (
            <Badge tone="yellow" icon={Plane}>
              {TIME_OFF_PENDING}
            </Badge>
          )}
        </span>
      </span>
    ),
  },
  {
    id: "role",
    header: "Role",
    width: "14%",
    render: (staff) => roleLabel(staff.role),
  },
  {
    id: "subjects",
    header: "Subjects",
    render: (staff) => (
      <span
        className={
          staff.subjects.length === 0 ? "text-(--tl-muted)" : undefined
        }
      >
        {getSubjectsText(staff)}
      </span>
    ),
  },
  {
    id: "sign-in",
    header: "Sign-in state",
    width: "18%",
    render: getStateBadge,
  },
];

function getPhoneRow(staff: StaffRead): PhoneRow {
  const role = roleLabel(staff.role);
  return {
    leading: <Avatar name={staff.name} />,
    title: staff.name,
    subtitle:
      staff.role === "admin" ? role : `${role} · ${getSubjectsText(staff)}`,
    meta: staff.has_pending_time_off ? TIME_OFF_PENDING : undefined,
    trailing: getStateBadge(staff),
  };
}

type StaffTableProps = {
  rows: StaffRead[];
  onOpen: (staff: StaffRead) => void;
};

export default function StaffTable({
  rows,
  onOpen,
}: StaffTableProps): ReactNode {
  return (
    <DataTable
      caption="Staff"
      rows={rows}
      columns={COLUMNS}
      getRowId={(staff) => staff.id}
      getRowTitle={(staff) => staff.name}
      getPhoneRow={getPhoneRow}
      isRowMuted={(staff) => staff.archived}
      onOpenRow={onOpen}
    />
  );
}
