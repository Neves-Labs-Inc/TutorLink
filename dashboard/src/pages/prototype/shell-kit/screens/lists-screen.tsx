// screen=lists: Office lists inside the real shell. Franklin chose A
// (2026-10-13): a table when there's room, tappable rows below. B (rich
// card rows at every width) stays reachable with ?variant=B for the
// archive branch.
// The dashed control switches the sample data and simulates states.
import { useState } from "react";
import type { ReactNode } from "react";
import { BookOpen, Mail, Plus, SearchX, UserPlus, Users } from "lucide-react";
import { BOOKINGS, STAFF } from "@/pages/prototype/shell-kit/kit/mock-data";
import type { Booking, Role, Staff } from "@/pages/prototype/shell-kit/kit/mock-data";
import {
  formatDay,
  getRelativeDayLabel,
  groupByDay,
  pluralize,
} from "@/pages/prototype/shell-kit/kit/format";
import {
  ArchivedBadge,
  Avatar,
  SignInBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import { ListRow } from "@/pages/prototype/shell-kit/kit/components/list-row";
import { SegmentedControl } from "@/pages/prototype/shell-kit/kit/components/tabs";
import { AppShell } from "@/pages/prototype/shell-kit/kit/shell/app-shell";
import type { NavId } from "@/pages/prototype/shell-kit/kit/shell/nav";
import { PageHeader } from "@/pages/prototype/shell-kit/kit/shell/page-header";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  TableSkeleton,
} from "@/pages/prototype/shell-kit/kit/states/states";
import type { PhoneDetailMode } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import BookingDetail from "@/pages/prototype/shell-kit/screens/booking-detail";
import BookingRow from "@/pages/prototype/shell-kit/screens/booking-row";
import { PrototypeControls } from "@/pages/prototype/shell-kit/screens/gallery";
import {
  BookingsTable,
  StaffTable,
} from "@/pages/prototype/shell-kit/screens/people-tables";
import StaffDetail from "@/pages/prototype/shell-kit/screens/staff-detail";
import FilterDropdowns from "@/pages/prototype/shell-kit/screens/filter-dropdowns";
import {
  BOOKING_FILTER_FIELDS,
  STAFF_FILTER_FIELDS,
  useBookingFilters,
  useStaffFilters,
} from "@/pages/prototype/shell-kit/screens/use-record-filters";
import { PageToolbar } from "@/pages/prototype/shell-kit/kit/shell/page-toolbar";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import {
  DATA_STATE_ITEMS,
  useSimulatedState,
} from "@/pages/prototype/shell-kit/screens/use-simulated-state";
import type { DataState } from "@/pages/prototype/shell-kit/screens/use-simulated-state";

type Dataset = "bookings" | "staff";
type ListsVariant = "A" | "B";

type ListsScreenProps = { role: Role; variant: ListsVariant };

export default function ListsScreen({
  role,
  variant,
}: ListsScreenProps): ReactNode {
  const [dataset, setDataset] = useState<Dataset>("bookings");
  const [openBooking, setOpenBooking] = useState<Booking | null>(null);
  const [openStaff, setOpenStaff] = useState<Staff | null>(null);
  const simulated = useSimulatedState();
  const [query, setQuery] = useState("");
  const bookingFilters = useBookingFilters();
  const staffFilters = useStaffFilters();
  const phoneMode: PhoneDetailMode = "page";
  const isBookings = dataset === "bookings";
  const effectiveRole = role === "tutor" ? "admin" : role;
  const needle = query.trim().toLowerCase();
  const bookingRows = bookingFilters
    .apply(BOOKINGS)
    .filter(
      (booking) =>
        needle === "" ||
        booking.child.toLowerCase().includes(needle) ||
        booking.staff.toLowerCase().includes(needle),
    );
  const staffRows = staffFilters
    .apply(STAFF)
    .filter((staff) => staff.name.toLowerCase().includes(needle));
  const filters = isBookings ? bookingFilters : staffFilters;
  const visibleCount = isBookings ? bookingRows.length : staffRows.length;

  function handleClearAll(): void {
    setQuery("");
    filters.clearAll();
  }

  function handleNavigate(id: NavId): void {
    if (id === "bookings") setDataset("bookings");
    if (id === "staff") setDataset("staff");
  }

  function renderBody(): ReactNode {
    let body: ReactNode;
    if (simulated.state === "loading") {
      body =
        variant === "A" ? (
          <div className="@container">
            <div className="hidden @3xl:block">
              <TableSkeleton label="Loading" />
            </div>
            <div className="@3xl:hidden">
              <ListSkeleton label="Loading" />
            </div>
          </div>
        ) : (
          <ListSkeleton label="Loading" />
        );
    } else if (simulated.state === "error") {
      body = (
        <ErrorState
          title={isBookings ? "Bookings didn’t load" : "Staff didn’t load"}
          body="Something went wrong on our side. Your data is safe; try again in a moment."
          onRetry={simulated.retry}
          isRetrying={simulated.isRetrying}
        />
      );
    } else if (simulated.state === "empty") {
      body = isBookings ? (
        <EmptyState
          icon={Plus}
          title="No bookings this week"
          body="When a Guardian books through the bot or the office adds one, it shows up here."
        />
      ) : (
        <EmptyState
          icon={Users}
          title="No Staff yet"
          body="Add your Tutors so Guardians can book them. You can send their Invite later."
        />
      );
    } else if (visibleCount === 0) {
      body = (
        <EmptyState
          icon={SearchX}
          title={isBookings ? "No bookings match" : "No Staff match"}
          body="Try another name, or clear the filters."
          action={<Button onClick={handleClearAll}>Clear search and filters</Button>}
        />
      );
    } else if (variant === "A") {
      body = isBookings ? (
        <BookingsTable rows={bookingRows} onOpen={setOpenBooking} />
      ) : (
        <StaffTable rows={staffRows} onOpen={setOpenStaff} />
      );
    } else {
      body = isBookings ? (
        <BookingRows rows={bookingRows} onOpen={setOpenBooking} />
      ) : (
        <StaffRows rows={staffRows} onOpen={setOpenStaff} />
      );
    }
    return body;
  }

  return (
    <AppShell
      role={effectiveRole}
      activeId={isBookings ? "bookings" : "staff"}
      onNavigate={handleNavigate}
    >
      <PageHeader
        title={isBookings ? "Bookings" : "Staff"}
        description={
          variant === "A"
            ? "A table when the content area is 768px or wider, tappable rows below that."
            : "Archived variant B: rich card rows at every width."
        }
        primaryAction={
          isBookings
            ? { label: "New booking", icon: Plus, onClick: () => undefined }
            : { label: "Add staff", icon: UserPlus, onClick: () => undefined }
        }
      >
        <PageToolbar
          searchLabel={isBookings ? "Search bookings" : "Search Staff"}
          searchPlaceholder={isBookings ? "Search a Child or Staff" : "Search by name"}
          query={query}
          onQueryChange={setQuery}
          activeFilterCount={filters.activeCount}
          onClearFilters={filters.clearAll}
          filters={
            isBookings ? (
              <FilterDropdowns
                fields={BOOKING_FILTER_FIELDS}
                selected={bookingFilters.selected}
                onChange={bookingFilters.set}
              />
            ) : (
              <FilterDropdowns
                fields={STAFF_FILTER_FIELDS}
                selected={staffFilters.selected}
                onChange={staffFilters.set}
              />
            )
          }
        />
      </PageHeader>
      <PrototypeControls label="Sample">
        <SegmentedControl
          label="Sample data"
          activeId={dataset}
          // Ids come from the two items below.
          onChange={(id) => setDataset(id as Dataset)}
          items={[
            { id: "bookings", label: "Bookings" },
            { id: "staff", label: "Staff" },
          ]}
        />
        <SegmentedControl
          label="Data state"
          activeId={simulated.state}
          // Ids come from DATA_STATE_ITEMS, so each is a DataState.
          onChange={(id) => simulated.setState(id as DataState)}
          items={DATA_STATE_ITEMS}
        />
      </PrototypeControls>
      {renderBody()}
      <BookingDetail
        booking={openBooking}
        onClose={() => setOpenBooking(null)}
        phoneMode={phoneMode}
      />
      <StaffDetail
        staff={openStaff}
        onClose={() => setOpenStaff(null)}
        phoneMode={phoneMode}
      />
    </AppShell>
  );
}

function BookingRows({
  rows,
  onOpen,
}: {
  rows: Booking[];
  onOpen: (booking: Booking) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-8">
      {groupByDay(rows).map((group) => (
        <section key={group.dayKey} aria-labelledby={`l-${group.dayKey}`}>
          <h2 id={`l-${group.dayKey}`} className="flex items-baseline gap-3 px-1 pb-3">
            <span className="kit-display text-[18px] font-bold">
              {getRelativeDayLabel(group.dayKey)}
            </span>
            <span className="text-[14px] text-(--tl-muted)">
              {formatDay(group.dayKey, { weekday: "short", month: "short", day: "numeric" })}{" "}
              · {pluralize(group.items.length, "booking", "bookings")}
            </span>
          </h2>
          <div className="flex flex-col gap-3">
            {group.items.map((booking) => (
              <BookingRow key={booking.id} booking={booking} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function StaffRows({
  rows,
  onOpen,
}: {
  rows: Staff[];
  onOpen: (staff: Staff) => void;
}): ReactNode {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((staff) => (
        <ListRow
          key={staff.id}
          leading={<Avatar name={staff.name} size="lg" />}
          title={staff.name}
          subtitle={`${staff.role} · ${pluralize(staff.sessionsThisWeek, "booking", "bookings")} this week`}
          isMuted={staff.isArchived}
          badges={
            staff.isArchived ? (
              <ArchivedBadge />
            ) : (
              <SignInBadge state={staff.signIn} />
            )
          }
          details={[
            { icon: Mail, text: staff.email || "No email yet" },
            { icon: BookOpen, text: staff.subjects.join(", ") },
          ]}
          onOpen={() => onOpen(staff)}
        />
      ))}
    </div>
  );
}
