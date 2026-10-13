// Bookings: header with "New booking", search, filters and the List /
// Calendar view switch, then the "To sort out" banner (Evaluations to
// book, Bookings to sort out), then the list grouped by day.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  CalendarClock,
  CalendarDays,
  CalendarSearch,
  List,
  Plus,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  BOOKINGS,
  CURRENT_USER,
  getBookingAttentionFor,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import { AttentionBanner } from "@/pages/prototype/shell-kit/kit/components/attention-banner";
import AccountDetails from "@/pages/prototype/shell-kit/screens/account-details";
import type { AccountEntry } from "@/pages/prototype/shell-kit/screens/account-details";
import type { Booking, Role } from "@/pages/prototype/shell-kit/kit/mock-data";
import { QuickFilter } from "@/pages/prototype/shell-kit/kit/components/quick-filter";
import {
  formatDay,
  getRelativeDayLabel,
  groupByDay,
  pluralize,
} from "@/pages/prototype/shell-kit/kit/format";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { SegmentedControl } from "@/pages/prototype/shell-kit/kit/components/tabs";
import {
  EyebrowPill,
  PageHeader,
} from "@/pages/prototype/shell-kit/kit/shell/page-header";
import { PageToolbar } from "@/pages/prototype/shell-kit/kit/shell/page-toolbar";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";
import { EmptyState } from "@/pages/prototype/shell-kit/kit/states/states";
import type { PhoneDetailMode } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { BookingsTable } from "@/pages/prototype/shell-kit/screens/people-tables";
import BookingDetail from "@/pages/prototype/shell-kit/screens/booking-detail";
import FilterDropdowns from "@/pages/prototype/shell-kit/screens/filter-dropdowns";
import {
  BOOKING_FILTER_FIELDS,
  useBookingFilters,
} from "@/pages/prototype/shell-kit/screens/use-record-filters";

type BookingsPageProps = { role?: Role; phoneMode?: PhoneDetailMode };

export default function BookingsPage({
  role = "admin",
  phoneMode = "page",
}: BookingsPageProps): ReactNode {
  const [query, setQuery] = useState("");
  const filters = useBookingFilters();
  // Managers also teach, so they get a one-tap "Mine". Admins don't.
  const canFilterMine = role === "manager";
  const [isMineOnly, setIsMineOnly] = useState(false);
  const myName = CURRENT_USER[role].name;
  const [view, setView] = useState("list");
  const [openBooking, setOpenBooking] = useState<Booking | null>(null);
  const [accountStack, setAccountStack] = useState<AccountEntry[]>([]);
  const attention = getBookingAttentionFor(role);
  const { showToast } = useToast();

  const needle = query.trim().toLowerCase();
  const visible = filters.apply(BOOKINGS).filter(
    (booking) =>
      (!isMineOnly || booking.staff === myName) &&
      (needle === "" ||
        booking.child.toLowerCase().includes(needle) ||
        booking.staff.toLowerCase().includes(needle)),
  );
  const groups = groupByDay(visible);
  const evaluations = BOOKINGS.filter((booking) => booking.kind === "Evaluation");

  return (
    <>
      <PageHeader
        eyebrow={<EyebrowPill>Week of October 12</EyebrowPill>}
        title="Bookings"
        description={`${pluralize(BOOKINGS.length, "booking", "bookings")} this week, ${evaluations.length} of them Evaluations.`}
        primaryAction={{
          label: "New booking",
          icon: Plus,
          onClick: () =>
            showToast({
              tone: "info",
              message: "New booking is designed in the Bookings prototype.",
            }),
        }}
      >
        <PageToolbar
          searchLabel="Search bookings"
          searchPlaceholder="Search a Child or Staff"
          query={query}
          onQueryChange={setQuery}
          activeFilterCount={filters.activeCount + (isMineOnly ? 1 : 0)}
          onClearFilters={() => {
            filters.clearAll();
            setIsMineOnly(false);
          }}
          filters={
            <>
              {canFilterMine && (
                <QuickFilter
                  label="Mine"
                  icon={UserRound}
                  isOn={isMineOnly}
                  onToggle={() => setIsMineOnly(!isMineOnly)}
                />
              )}
              <FilterDropdowns
                fields={BOOKING_FILTER_FIELDS}
                selected={filters.selected}
                onChange={filters.set}
              />
            </>
          }
          view={
            <SegmentedControl
              label="Bookings view"
              activeId={view}
              onChange={setView}
              items={[
                { id: "list", label: "List", icon: List },
                { id: "calendar", label: "Calendar", icon: CalendarDays },
              ]}
            />
          }
        />
      </PageHeader>
      <AttentionBanner
        title="To sort out"
        groups={[
          {
            title: "Evaluations to book",
            rows: attention
              .filter((item) => item.kind === "evaluation")
              .map((item) => ({
                id: item.id,
                icon: Sparkles,
                iconClasses: "bg-(--tl-pink-tint) text-(--tl-pink-ink)",
                title: item.title,
                detail: item.detail,
                cue: "Book evaluation",
                onOpen: () => setAccountStack([{ kind: "child", id: item.refId }]),
              })),
          },
          {
            title: "Bookings to sort out",
            rows: attention
              .filter((item) => item.kind === "booking")
              .map((item) => ({
                id: item.id,
                icon: CalendarClock,
                iconClasses: "bg-(--tl-green-tint) text-(--tl-green-ink)",
                title: item.title,
                detail: item.detail,
                cue: "Open booking",
                onOpen: () =>
                  setOpenBooking(BOOKINGS.find((booking) => booking.id === item.refId) ?? null),
              })),
          },
        ]}
      />

      {view === "calendar" && (
        <EmptyState
          icon={CalendarDays}
          title="Calendar lives in the Bookings prototype"
          body="The shell kit only shows where the view switch sits. The week and day calendars are designed in their own area prototype."
        />
      )}
      {view === "list" && groups.length === 0 && (
        <EmptyState
          icon={CalendarSearch}
          title="No bookings match"
          body="Try another name, or clear the filters to see the whole week."
          action={
            <Button
              onClick={() => {
                setQuery("");
                filters.clearAll();
                setIsMineOnly(false);
              }}
            >
              Clear search and filters
            </Button>
          }
        />
      )}
      {view === "list" && groups.length > 0 && (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.dayKey} aria-labelledby={`day-${group.dayKey}`}>
              <h2
                id={`day-${group.dayKey}`}
                className="flex items-baseline gap-3 px-1 pb-3"
              >
                <span className="kit-display text-[18px] font-bold">
                  {getRelativeDayLabel(group.dayKey)}
                </span>
                <span className="text-[14px] text-(--tl-muted)">
                  {formatDay(group.dayKey, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  · {pluralize(group.items.length, "booking", "bookings")}
                </span>
              </h2>
              <BookingsTable rows={group.items} onOpen={setOpenBooking} />
            </section>
          ))}
        </div>
      )}
      <BookingDetail
        booking={openBooking}
        onClose={() => setOpenBooking(null)}
        phoneMode={phoneMode}
      />
      <AccountDetails stack={accountStack} onChange={setAccountStack} rootLabel="Bookings" />
    </>
  );
}
