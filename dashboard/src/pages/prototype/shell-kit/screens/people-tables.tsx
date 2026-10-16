// Office data in the kit's DataTable (lists fork A). Shared by the
// Families (Children, Guardians), Staff and Bookings pages and the lists
// screen.
import type { ReactNode } from "react";
import {
  CHILDREN,
  getGuardiansOf,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type {
  Booking,
  Child,
  Guardian,
  Staff,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  ArchivedBadge,
  Avatar,
  BookingStatusBadge,
  EvaluatedBadge,
  KindBadge,
  RemindersBadge,
  SignInBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { DataTable } from "@/pages/prototype/shell-kit/kit/components/data-table";
import type { Column } from "@/pages/prototype/shell-kit/kit/components/data-table";
import { formatDay, formatTime, getDayKey } from "@/pages/prototype/shell-kit/kit/format";

function NameCell({
  name,
  secondary,
}: {
  name: string;
  secondary: string;
}): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar name={name} />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-semibold">{name}</span>
        <span className="block truncate text-[13px] text-(--tl-muted)">
          {secondary}
        </span>
      </span>
    </span>
  );
}

function getStaffStateBadge(staff: Staff): ReactNode {
  return staff.isArchived ? (
    <ArchivedBadge />
  ) : (
    <SignInBadge state={staff.signIn} />
  );
}

const STAFF_COLUMNS: Column<Staff>[] = [
  {
    id: "name",
    header: "Name",
    width: "32%",
    render: (staff) => (
      <NameCell name={staff.name} secondary={staff.email || "No email yet"} />
    ),
  },
  { id: "role", header: "Role", render: (staff) => staff.role },
  {
    id: "subjects",
    header: "Subjects",
    isWideOnly: true,
    render: (staff) => staff.subjects.join(", "),
  },
  {
    id: "week",
    header: "This week",
    render: (staff) => (
      <span className="tabular-nums">
        {staff.sessionsThisWeek} {staff.sessionsThisWeek === 1 ? "booking" : "bookings"}
      </span>
    ),
  },
  { id: "signin", header: "Sign-in", render: getStaffStateBadge },
];

type TableProps<T> = { rows: T[]; onOpen: (row: T) => void };

export function StaffTable({ rows, onOpen }: TableProps<Staff>): ReactNode {
  return (
    <DataTable
      caption="Staff"
      rows={rows}
      columns={STAFF_COLUMNS}
      getRowId={(staff) => staff.id}
      getRowTitle={(staff) => staff.name}
      isRowMuted={(staff) => staff.isArchived}
      onOpenRow={onOpen}
      getPhoneRow={(staff) => ({
        leading: <Avatar name={staff.name} />,
        title: staff.name,
        subtitle: `${staff.role} · ${staff.subjects.join(", ")}`,
        trailing: getStaffStateBadge(staff),
      })}
    />
  );
}

function getGuardianColumns(
  getHomeCount: (guardian: Guardian) => number,
): Column<Guardian>[] {
  return [
    {
      id: "name",
      header: "Guardian",
      width: "24%",
      render: (guardian) => (
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={guardian.name} />
          <span className="truncate text-[15px] font-semibold">{guardian.name}</span>
        </span>
      ),
    },
    {
      id: "phone",
      header: "Phone",
      render: (guardian) => (
        <span className="whitespace-nowrap tabular-nums">{guardian.phone}</span>
      ),
    },
    {
      id: "language",
      header: "Guardian language",
      isWideOnly: true,
      render: (guardian) => guardian.language,
    },
    {
      id: "reminders",
      header: "Booking reminders",
      render: (guardian) => <RemindersBadge state={guardian.reminders} />,
    },
    {
      id: "children",
      header: "Children",
      render: (guardian) => guardian.children.join(", "),
    },
    {
      id: "homes",
      header: "Homes",
      width: "90px",
      render: (guardian) => <span className="tabular-nums">{getHomeCount(guardian)}</span>,
    },
  ];
}

type GuardiansTableProps = TableProps<Guardian> & {
  getHomeCount: (guardian: Guardian) => number;
};

export function GuardiansTable({
  rows,
  onOpen,
  getHomeCount,
}: GuardiansTableProps): ReactNode {
  return (
    <DataTable
      caption="Guardians"
      rows={rows}
      columns={getGuardianColumns(getHomeCount)}
      getRowId={(guardian) => guardian.id}
      getRowTitle={(guardian) => guardian.name}
      onOpenRow={onOpen}
      getPhoneRow={(guardian) => ({
        leading: <Avatar name={guardian.name} />,
        title: guardian.name,
        subtitle: `Children: ${guardian.children.join(", ")}`,
        meta: `${guardian.phone} · ${guardian.language} · ${getHomeCount(guardian)} ${getHomeCount(guardian) === 1 ? "Home" : "Homes"}`,
        trailing: <RemindersBadge state={guardian.reminders} />,
      })}
    />
  );
}

const CHILD_COLUMNS: Column<Child>[] = [
  {
    id: "name",
    header: "Child",
    width: "30%",
    render: (child) => (
      <NameCell
        name={child.name}
        secondary={getGuardiansOf(child.name)
          .map((guardian) => guardian.name)
          .join(", ")}
      />
    ),
  },
  {
    id: "grade",
    header: "Overall grade",
    isWideOnly: true,
    render: (child) => child.overallGrade,
  },
  {
    id: "subjects",
    header: "Subject levels",
    render: (child) =>
      child.subjects.length > 0 ? (
        child.subjects.join(", ")
      ) : (
        <span className="text-(--tl-muted)">None yet</span>
      ),
  },
  {
    id: "evaluated",
    header: "Evaluation",
    render: (child) => <EvaluatedBadge isEvaluated={child.isEvaluated} />,
  },
];

export function ChildrenTable({
  rows = CHILDREN,
  onOpen,
}: Partial<TableProps<Child>> & { onOpen: (row: Child) => void }): ReactNode {
  return (
    <DataTable
      caption="Children"
      rows={rows}
      columns={CHILD_COLUMNS}
      getRowId={(child) => child.id}
      getRowTitle={(child) => child.name}
      onOpenRow={onOpen}
      getPhoneRow={(child) => ({
        leading: <Avatar name={child.name} />,
        title: child.name,
        subtitle: `${child.overallGrade} · ${getGuardiansOf(child.name)
          .map((guardian) => guardian.name)
          .join(", ")}`,
        trailing: <EvaluatedBadge isEvaluated={child.isEvaluated} />,
      })}
    />
  );
}

const BOOKING_COLUMNS: Column<Booking>[] = [
  {
    id: "when",
    header: "When",
    width: "140px",
    render: (booking) => (
      <span className="tabular-nums">
        <span className="block text-[15px] font-semibold">
          {formatTime(booking.start)}
        </span>
        <span className="block text-[13px] text-(--tl-muted)">
          {formatDay(getDayKey(booking.start), {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </span>
      </span>
    ),
  },
  {
    id: "child",
    header: "Child",
    render: (booking) => (
      <span>
        <span
          className={
            booking.status === "Cancelled"
              ? "block font-semibold line-through"
              : "block font-semibold"
          }
        >
          {booking.child}
        </span>
        <span className="block text-[13px] text-(--tl-muted)">
          {booking.subject} · {booking.level}
        </span>
      </span>
    ),
  },
  { id: "kind", header: "Kind", render: (booking) => <KindBadge kind={booking.kind} /> },
  {
    id: "staff",
    header: "Staff",
    render: (booking) => (
      <span className="flex items-center gap-2">
        <Avatar name={booking.staff} size="sm" />
        {booking.staff}
      </span>
    ),
  },
  {
    id: "location",
    header: "Location",
    isWideOnly: true,
    render: (booking) => (
      <span className="line-clamp-2 text-(--tl-ink-soft)">{booking.location}</span>
    ),
  },
  {
    id: "status",
    header: "Status",
    render: (booking) => <BookingStatusBadge status={booking.status} />,
  },
];

export function BookingsTable({
  rows,
  onOpen,
}: TableProps<Booking>): ReactNode {
  return (
    <DataTable
      caption="Bookings"
      rows={rows}
      columns={BOOKING_COLUMNS}
      getRowId={(booking) => booking.id}
      getRowTitle={(booking) => `${booking.child}, ${formatTime(booking.start)}`}
      isRowMuted={(booking) => booking.status === "Cancelled"}
      onOpenRow={onOpen}
      getPhoneRow={(booking) => ({
        title: booking.child,
        subtitle: `${booking.kind} · ${booking.subject} · ${booking.staff}`,
        meta: `${formatDay(getDayKey(booking.start), { weekday: "short", month: "short", day: "numeric" })}, ${formatTime(booking.start)}`,
        trailing: <BookingStatusBadge status={booking.status} />,
      })}
    />
  );
}
