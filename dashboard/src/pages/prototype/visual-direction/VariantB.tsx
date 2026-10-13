// Variant B, "Calm product": a dense, neutral-first product UI where the brand
// blue is a signature accent, not the wallpaper. Throwaway prototype (#187),
// so everything lives in this one file by the contract's file ownership.
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  HeartHandshake,
  House,
  MapPin,
  MessageSquare,
  MessagesSquare,
  Navigation,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  StickyNote,
  SwatchBook,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  bookings,
  currentTutor,
  today,
  todo,
  tutorSessions,
  weekStart,
  type Booking,
  type BookingKind,
  type BookingStatus,
  type Screen,
  type Theme,
  type VariantProps,
} from "@/pages/prototype/visual-direction/mockData";
import "./variantB.css";

export const variantName = "Calm product";

// The prototype's frozen clock: Tuesday afternoon in Doral.
const NOW = "2026-10-13T14:20:00";
const OFFICE_USER = { name: "Marisol Duarte", role: "Admin" };
const BUSINESS_NAME = "M's Helping Hands";

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;
const MINUTES_PER_HOUR = 60;
const WEEK_HOUR_PX = 48;
const DAY_HOUR_PX = 60;
const DAYS_IN_WEEK = 7;
const MIN_BLOCK_FOR_THIRD_LINE_PX = 64;

const HOURS = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR },
  (_, index) => DAY_START_HOUR + index,
);

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const STATUS_TONE: Record<BookingStatus, Tone> = {
  Upcoming: "info",
  Completed: "success",
  Pending: "warning",
  Cancelled: "danger",
  "Taken over": "neutral",
};

const TONE_CLASS: Record<Tone, string> = {
  info: "bg-[var(--vb-info-bg)] text-[var(--vb-info-fg)]",
  success: "bg-[var(--vb-success-bg)] text-[var(--vb-success-fg)]",
  warning: "bg-[var(--vb-warning-bg)] text-[var(--vb-warning-fg)]",
  danger: "bg-[var(--vb-danger-bg)] text-[var(--vb-danger-fg)]",
  neutral: "bg-[var(--vb-neutral-bg)] text-[var(--vb-neutral-fg)]",
};

const AVATAR_COLORS = [
  "var(--vb-pastel-blue)",
  "var(--vb-pastel-pink)",
  "var(--vb-pastel-yellow)",
  "var(--vb-pastel-green)",
  "var(--vb-pastel-mauve)",
];

type NavItem = { label: string; icon: LucideIcon; count?: number };

const OFFICE_NAV: NavItem[] = [
  { label: "Home", icon: House, count: todo.length },
  { label: "Bookings", icon: CalendarDays },
  { label: "Chats", icon: MessagesSquare, count: 2 },
  { label: "People", icon: Users },
  { label: "Settings", icon: Settings },
];

const TUTOR_NAV: NavItem[] = [
  { label: "My sessions", icon: CalendarDays },
  { label: "My availability", icon: CalendarClock },
  { label: "Time off", icon: CalendarOff },
];

// ---------------------------------------------------------------------------
// Date helpers (local ISO strings, no timezone maths: the business tz is fixed)

function getDayKey(iso: string): string {
  return iso.slice(0, 10);
}

function addDays(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function getMinutesIntoDay(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * MINUTES_PER_HOUR + date.getMinutes();
}

function getEndMinutes(booking: Booking): number {
  return getMinutesIntoDay(booking.start) + booking.durationMin;
}

function formatClock(totalMinutes: number): string {
  const date = new Date(2026, 0, 1, 0, totalMinutes);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTime(iso: string): string {
  return formatClock(getMinutesIntoDay(iso));
}

function formatTimeRange(booking: Booking): string {
  return `${formatTime(booking.start)} – ${formatClock(getEndMinutes(booking))}`;
}

function formatDay(dayKey: string, isLong = false): string {
  return new Date(`${dayKey}T00:00:00`).toLocaleDateString("en-US", {
    weekday: isLong ? "long" : "short",
    month: isLong ? "long" : "short",
    day: "numeric",
  });
}

function formatHour(hour: number): string {
  const suffix = hour < 12 ? "AM" : "PM";
  return `${hour % 12 === 0 ? 12 : hour % 12} ${suffix}`;
}

function getWeekDays(): string[] {
  return Array.from({ length: DAYS_IN_WEEK }, (_, index) =>
    addDays(weekStart, index),
  );
}

function groupByDay(list: Booking[]): [string, Booking[]][] {
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  const groups = sorted.reduce<Record<string, Booking[]>>(
    (acc, booking) => ({
      ...acc,
      [getDayKey(booking.start)]: [
        ...(acc[getDayKey(booking.start)] ?? []),
        booking,
      ],
    }),
    {},
  );
  return Object.entries(groups);
}

function isPast(booking: Booking): boolean {
  return booking.start < NOW;
}

// The office's "next thing happening": first live booking after now.
function getNextBooking(list: Booking[]): Booking | null {
  return (
    list.find((booking) => !isPast(booking) && booking.status !== "Cancelled") ??
    null
  );
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function getAvatarColor(name: string): string {
  const hash = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function getScreenHref(theme: Theme, screen: Screen): string {
  return `?variant=B&theme=${theme}&screen=${screen}`;
}

function getShortAddress(location: string): string {
  return location.split(",")[0];
}

type PlacedBooking = { booking: Booking; lane: number; laneCount: number };

// Side-by-side lanes for overlapping bookings in one day column.
function placeBookings(dayBookings: Booking[]): PlacedBooking[] {
  const sorted = [...dayBookings].sort((a, b) => a.start.localeCompare(b.start));
  const clusters = sorted.reduce<Booking[][]>((acc, booking) => {
    const last = acc.at(-1);
    if (
      last &&
      last.some(
        (other) => getEndMinutes(other) > getMinutesIntoDay(booking.start),
      )
    ) {
      return [...acc.slice(0, -1), [...last, booking]];
    }
    return [...acc, [booking]];
  }, []);
  return clusters.flatMap((cluster) =>
    cluster.map((booking, index) => ({
      booking,
      lane: index,
      laneCount: cluster.length,
    })),
  );
}

function getBlockGeometry(
  booking: Booking,
  hourPx: number,
): { top: number; height: number } {
  const startOffset =
    getMinutesIntoDay(booking.start) - DAY_START_HOUR * MINUTES_PER_HOUR;
  return {
    top: (startOffset / MINUTES_PER_HOUR) * hourPx,
    height: (booking.durationMin / MINUTES_PER_HOUR) * hourPx,
  };
}

// ---------------------------------------------------------------------------
// Root

export function VariantB({ theme, screen }: VariantProps): React.ReactNode {
  const [isSpecOpen, setIsSpecOpen] = useState(false);

  function handleToggleSpec(): void {
    setIsSpecOpen((isOpen) => !isOpen);
  }

  let content: React.ReactNode;
  if (screen === "tutor") {
    content = <TutorScreen onOpenTokens={handleToggleSpec} />;
  } else {
    content = (
      <OfficeShell theme={theme} screen={screen} onOpenTokens={handleToggleSpec}>
        {screen === "list" ? <BookingsList /> : <BookingsCalendar />}
      </OfficeShell>
    );
  }

  return (
    <div
      data-variant="b"
      data-theme={theme}
      className="relative flex h-dvh max-h-full w-full flex-col overflow-hidden"
    >
      {content}
      {isSpecOpen && (
        <SpecPanel
          theme={theme}
          isCompact={screen === "tutor"}
          onClose={() => setIsSpecOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small parts

function StatusBadge({ status }: { status: BookingStatus }): React.ReactNode {
  return (
    <span className={`vb-badge ${TONE_CLASS[STATUS_TONE[status]]}`}>
      <span className="vb-badge-dot" aria-hidden />
      {status}
    </span>
  );
}

// Evaluation gets the one pastel marker; Tutoring stays plain text so the
// rarer kind is what catches the eye.
function KindLabel({ kind }: { kind: BookingKind }): React.ReactNode {
  if (kind === "Tutoring") {
    return <span className="text-[var(--vb-text-2)]">Tutoring</span>;
  }
  return (
    <span className="inline-flex h-5 items-center gap-1.5 rounded-[var(--vb-radius-sm)] bg-[var(--vb-eval-chip-bg)] px-1.5 text-[12px] font-medium text-[var(--vb-eval-chip-fg)]">
      <span
        className="size-1.5 rotate-45 bg-[var(--vb-eval-bar)]"
        aria-hidden
      />
      Evaluation
    </span>
  );
}

function Avatar({
  name,
  size = 20,
}: {
  name: string;
  size?: number;
}): React.ReactNode {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-[var(--vb-on-pastel)]"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: getAvatarColor(name),
      }}
      aria-hidden
    >
      {getInitials(name)}
    </span>
  );
}

function BrandMark({ size = 24 }: { size?: number }): React.ReactNode {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[var(--vb-radius)] bg-[var(--vb-blue-200)] text-[var(--vb-blue-800)]"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <HeartHandshake size={Math.round(size * 0.62)} strokeWidth={2} />
    </span>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  isTouchOnly = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick?: () => void;
  // The tutor screen renders in a phone frame on wide viewports, so it can't
  // rely on breakpoints to know it's on a phone.
  isTouchOnly?: boolean;
}): React.ReactNode {
  const sizeClass = isTouchOnly ? "size-11" : "size-11 md:size-[30px]";
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`vb-btn vb-btn-ghost p-0 ${sizeClass}`}
    >
      <Icon size={18} />
    </button>
  );
}

function LocationLine({
  location,
  isShort = false,
}: {
  location: string;
  isShort?: boolean;
}): React.ReactNode {
  const isOffice = location === "In office";
  const Icon = isOffice ? Building2 : MapPin;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Icon size={13} className="shrink-0 text-[var(--vb-text-3)]" aria-hidden />
      <span className="truncate">
        {isShort ? getShortAddress(location) : location}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Office shell: slim sidebar on desktop, top bar + bottom tabs on phones

type OfficeShellProps = {
  theme: Theme;
  screen: Screen;
  onOpenTokens: () => void;
  children: React.ReactNode;
};

function OfficeShell({
  theme,
  screen,
  onOpenTokens,
  children,
}: OfficeShellProps): React.ReactNode {
  return (
    <div className="flex min-h-0 flex-1">
      <Sidebar onOpenTokens={onOpenTokens} />
      <main className="flex min-w-0 flex-1 flex-col bg-[var(--vb-surface)]">
        <PageHeader theme={theme} screen={screen} onOpenTokens={onOpenTokens} />
        <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>
        <BottomTabs items={OFFICE_NAV} active="Bookings" />
      </main>
    </div>
  );
}

function Sidebar({ onOpenTokens }: { onOpenTokens: () => void }): React.ReactNode {
  return (
    <aside className="hidden w-[220px] shrink-0 flex-col border-r border-[var(--vb-border)] bg-[var(--vb-sidebar)] md:flex">
      <div className="flex h-12 items-center gap-2 px-3">
        <BrandMark />
        <span className="vb-display truncate text-[14px] font-semibold">
          {BUSINESS_NAME}
        </span>
      </div>
      <div className="px-2 pb-2">
        <button
          type="button"
          className="vb-btn w-full justify-start text-[var(--vb-text-3)]"
        >
          <Search size={14} aria-hidden />
          <span className="flex-1 text-left font-normal">Search</span>
          <span className="vb-kbd">⌘K</span>
        </button>
      </div>
      <nav aria-label="Office" className="flex flex-col gap-px px-2">
        {OFFICE_NAV.map((item) => (
          <SidebarLink
            key={item.label}
            item={item}
            isActive={item.label === "Bookings"}
          />
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-px border-t border-[var(--vb-border)] p-2">
        <button
          type="button"
          onClick={onOpenTokens}
          className="flex h-8 items-center gap-2 rounded-[var(--vb-radius)] px-2 text-[13px] text-[var(--vb-text-2)] hover:bg-[var(--vb-hover)]"
        >
          <SwatchBook size={15} aria-hidden />
          Design tokens
        </button>
        <div className="flex h-10 items-center gap-2 px-2">
          <Avatar name={OFFICE_USER.name} size={24} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13px] font-medium">
              {OFFICE_USER.name}
            </div>
            <div className="text-[12px] text-[var(--vb-text-3)]">
              {OFFICE_USER.role}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({
  item,
  isActive,
}: {
  item: NavItem;
  isActive: boolean;
}): React.ReactNode {
  const Icon = item.icon;
  const stateClass = isActive
    ? "bg-[var(--vb-selected)] text-[var(--vb-selected-text)]"
    : "text-[var(--vb-text-2)] hover:bg-[var(--vb-hover)] hover:text-[var(--vb-text)]";
  return (
    <a
      href="#"
      aria-current={isActive ? "page" : undefined}
      className={`flex h-8 items-center gap-2 rounded-[var(--vb-radius)] px-2 text-[13px] font-medium ${stateClass}`}
    >
      <Icon size={16} aria-hidden />
      <span className="flex-1">{item.label}</span>
      {item.count !== undefined && (
        <span className="vb-num text-[12px] text-[var(--vb-text-3)]">
          {item.count}
        </span>
      )}
    </a>
  );
}

function PageHeader({
  theme,
  screen,
  onOpenTokens,
}: {
  theme: Theme;
  screen: Screen;
  onOpenTokens: () => void;
}): React.ReactNode {
  const tabs: { label: string; screen: Screen }[] = [
    { label: "List", screen: "list" },
    { label: "Calendar", screen: "calendar" },
  ];
  return (
    <header className="shrink-0 border-b border-[var(--vb-border)]">
      <div className="flex h-12 items-center gap-3 px-2 md:px-5">
        <span className="pl-2 md:hidden">
          <BrandMark size={22} />
        </span>
        <h1 className="vb-display text-[18px] font-semibold md:text-[20px]">
          Bookings
        </h1>
        <nav
          aria-label="Bookings views"
          className="ml-4 hidden h-full items-stretch gap-4 md:flex"
        >
          {tabs.map((tab) => (
            <HeaderTab
              key={tab.screen}
              label={tab.label}
              href={getScreenHref(theme, tab.screen)}
              isActive={tab.screen === screen}
            />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:gap-2">
          <span className="md:hidden">
            <IconButton icon={Search} label="Search" />
          </span>
          <span className="md:hidden">
            <IconButton
              icon={SwatchBook}
              label="Design tokens"
              onClick={onOpenTokens}
            />
          </span>
          <button
            type="button"
            className="vb-btn vb-btn-primary hidden md:inline-flex"
          >
            <Plus size={15} aria-hidden />
            New booking
          </button>
        </div>
      </div>
      <nav
        aria-label="Bookings views"
        className="flex h-11 items-stretch border-t border-[var(--vb-border)] md:hidden"
      >
        {tabs.map((tab) => (
          <HeaderTab
            key={tab.screen}
            label={tab.label}
            href={getScreenHref(theme, tab.screen)}
            isActive={tab.screen === screen}
            isFullWidth
          />
        ))}
      </nav>
    </header>
  );
}

function HeaderTab({
  label,
  href,
  isActive,
  isFullWidth = false,
}: {
  label: string;
  href: string;
  isActive: boolean;
  isFullWidth?: boolean;
}): React.ReactNode {
  const stateClass = isActive
    ? "border-[var(--vb-accent)] text-[var(--vb-text)]"
    : "border-transparent text-[var(--vb-text-3)] hover:text-[var(--vb-text)]";
  return (
    <Link
      to={href}
      aria-current={isActive ? "page" : undefined}
      className={`-mb-px flex items-center justify-center border-b-2 text-[13px] font-medium ${stateClass} ${isFullWidth ? "flex-1" : ""}`}
    >
      {label}
    </Link>
  );
}

function BottomTabs({
  items,
  active,
  isAlwaysVisible = false,
}: {
  items: NavItem[];
  active: string;
  isAlwaysVisible?: boolean;
}): React.ReactNode {
  return (
    <nav
      aria-label="Main"
      className={`shrink-0 border-t border-[var(--vb-border)] bg-[var(--vb-surface)] pb-[env(safe-area-inset-bottom)] ${isAlwaysVisible ? "flex" : "flex md:hidden"}`}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = item.label === active;
        return (
          <a
            key={item.label}
            href="#"
            aria-current={isActive ? "page" : undefined}
            className={`flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-medium ${isActive ? "text-[var(--vb-selected-text)]" : "text-[var(--vb-text-3)]"}`}
          >
            <span
              className={`flex h-6 w-10 items-center justify-center rounded-[var(--vb-radius)] ${isActive ? "bg-[var(--vb-selected)]" : ""}`}
            >
              <Icon size={18} aria-hidden />
            </span>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Bookings list

type KindFilter = "All" | BookingKind;
const KIND_FILTERS: KindFilter[] = ["All", "Tutoring", "Evaluation"];

function filterBookings(query: string, kind: KindFilter): Booking[] {
  const needle = query.trim().toLowerCase();
  return bookings.filter((booking) => {
    const isKindMatch = kind === "All" || booking.kind === kind;
    const haystack =
      `${booking.child} ${booking.guardian} ${booking.tutor} ${booking.subject}`.toLowerCase();
    return isKindMatch && haystack.includes(needle);
  });
}

function BookingsList(): React.ReactNode {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("All");
  const [selectedId, setSelectedId] = useState(
    getNextBooking(bookings)?.id ?? null,
  );
  const groups = groupByDay(filterBookings(query, kind));
  const count = groups.reduce((sum, [, list]) => sum + list.length, 0);

  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--vb-border)] px-4 py-2 md:flex-row md:items-center md:px-5">
        <label className="relative flex items-center md:w-64">
          <span className="sr-only">Search bookings</span>
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 text-[var(--vb-text-3)]"
            aria-hidden
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search child, guardian, tutor"
            className="vb-input h-10 w-full pl-8 pr-2 md:h-[30px]"
          />
        </label>
        <div className="flex items-center gap-2">
          <Segmented value={kind} options={KIND_FILTERS} onChange={setKind} />
          <button type="button" className="vb-btn hidden md:inline-flex">
            Status
            <ChevronDown size={14} aria-hidden />
          </button>
          <button type="button" className="vb-btn hidden md:inline-flex">
            Tutor
            <ChevronDown size={14} aria-hidden />
          </button>
          <span className="ml-auto md:hidden">
            <IconButton icon={SlidersHorizontal} label="More filters" />
          </span>
        </div>
        <div className="hidden items-center gap-2 md:ml-auto md:flex">
          <span className="vb-num text-[12px] text-[var(--vb-text-3)]">
            {count} bookings
          </span>
          <WeekPager />
        </div>
      </div>
      <div className="vb-scroll min-h-0 flex-1 overflow-auto">
        <BookingsTable
          groups={groups}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <BookingsPhoneList groups={groups} />
        {count === 0 && (
          <p className="px-5 py-10 text-center text-[13px] text-[var(--vb-text-3)]">
            No bookings match “{query}”.
          </p>
        )}
      </div>
    </>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: T[];
  onChange: (value: T) => void;
}): React.ReactNode {
  return (
    <div
      role="radiogroup"
      className="flex h-10 items-stretch rounded-[var(--vb-radius)] border border-[var(--vb-border-strong)] p-0.5 md:h-[30px]"
    >
      {options.map((option) => {
        const isActive = option === value;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option)}
            className={`rounded-[var(--vb-radius-sm)] px-2.5 text-[13px] font-medium ${isActive ? "bg-[var(--vb-selected)] text-[var(--vb-selected-text)]" : "text-[var(--vb-text-2)] hover:text-[var(--vb-text)]"}`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

function WeekPager(): React.ReactNode {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="vb-btn">
        Today
      </button>
      <IconButton icon={ChevronLeft} label="Previous week" />
      <span className="vb-num px-1 text-[13px] font-medium">
        Oct 12 – 18, 2026
      </span>
      <IconButton icon={ChevronRight} label="Next week" />
    </div>
  );
}

function DayHeading({ dayKey }: { dayKey: string }): React.ReactNode {
  const isToday = dayKey === today;
  return (
    <>
      {isToday && (
        <span className="text-[var(--vb-selected-text)]">Today · </span>
      )}
      <span className="vb-num">{formatDay(dayKey)}</span>
    </>
  );
}

type BookingsTableProps = {
  groups: [string, Booking[]][];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

const TABLE_COLUMNS = [
  "Time",
  "Child",
  "Kind",
  "Subject level",
  "Tutor",
  "Location",
  "Status",
];

function BookingsTable({
  groups,
  selectedId,
  onSelect,
}: BookingsTableProps): React.ReactNode {
  return (
    <table className="hidden w-full border-separate border-spacing-0 text-[13px] md:table">
      <thead>
        <tr>
          {TABLE_COLUMNS.map((column) => (
            <th
              key={column}
              scope="col"
              className="sticky top-0 z-10 h-8 border-b border-[var(--vb-border)] bg-[var(--vb-surface)] px-3 text-left text-[12px] font-medium text-[var(--vb-text-3)] first:pl-5"
            >
              {column}
            </th>
          ))}
          <th
            scope="col"
            className="sticky top-0 z-10 w-10 border-b border-[var(--vb-border)] bg-[var(--vb-surface)]"
          >
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      {groups.map(([dayKey, list]) => (
        <tbody key={dayKey}>
          <tr>
            <th
              colSpan={TABLE_COLUMNS.length + 1}
              scope="colgroup"
              className="h-8 border-b border-[var(--vb-border)] bg-[var(--vb-subtle)] px-5 text-left text-[12px] font-semibold text-[var(--vb-text-2)]"
            >
              <DayHeading dayKey={dayKey} />
              <span className="vb-num ml-2 font-normal text-[var(--vb-text-3)]">
                {list.length}
              </span>
            </th>
          </tr>
          {list.map((booking) => (
            <BookingRow
              key={booking.id}
              booking={booking}
              isSelected={booking.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </tbody>
      ))}
    </table>
  );
}

function BookingRow({
  booking,
  isSelected,
  onSelect,
}: {
  booking: Booking;
  isSelected: boolean;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const isCancelled = booking.status === "Cancelled";
  const rowClass = isSelected
    ? "bg-[var(--vb-selected)] shadow-[inset_2px_0_0_var(--vb-accent)]"
    : "hover:bg-[var(--vb-hover)]";
  const cellClass =
    "h-[var(--vb-row-h)] border-b border-[var(--vb-border)] px-3 whitespace-nowrap";
  return (
    <tr
      onClick={() => onSelect(booking.id)}
      aria-selected={isSelected}
      className={`cursor-default ${rowClass}`}
    >
      <td className={`${cellClass} vb-num pl-5`}>
        <span className={isCancelled ? "text-[var(--vb-text-3)]" : ""}>
          {formatTime(booking.start)}
        </span>
        <span className="ml-1.5 text-[var(--vb-text-3)]">
          {booking.durationMin}m
        </span>
      </td>
      <td className={cellClass}>
        <span
          className={`font-medium ${isCancelled ? "text-[var(--vb-text-3)] line-through" : ""}`}
        >
          {booking.child}
        </span>
      </td>
      <td className={cellClass}>
        <KindLabel kind={booking.kind} />
      </td>
      <td className={`${cellClass} text-[var(--vb-text-2)]`}>
        {booking.subject}
        <span className="text-[var(--vb-text-3)]"> · {booking.level}</span>
      </td>
      <td className={cellClass}>
        <span className="inline-flex items-center gap-2">
          <Avatar name={booking.tutor} />
          {booking.tutor}
        </span>
      </td>
      <td className={`${cellClass} max-w-[240px] text-[var(--vb-text-2)]`}>
        <LocationLine location={booking.location} isShort />
      </td>
      <td className={cellClass}>
        <StatusBadge status={booking.status} />
      </td>
      <td className={`${cellClass} pr-3 text-right`}>
        <button
          type="button"
          aria-label={`Actions for ${booking.child}`}
          className="vb-btn vb-btn-ghost size-7 p-0"
        >
          <Ellipsis size={16} />
        </button>
      </td>
    </tr>
  );
}

function BookingsPhoneList({
  groups,
}: {
  groups: [string, Booking[]][];
}): React.ReactNode {
  return (
    <div className="md:hidden">
      {groups.map(([dayKey, list]) => (
        <section key={dayKey} aria-label={formatDay(dayKey, true)}>
          <h2 className="sticky top-0 z-10 flex h-8 items-center border-b border-[var(--vb-border)] bg-[var(--vb-subtle)] px-4 text-[12px] font-semibold text-[var(--vb-text-2)]">
            <span>
              <DayHeading dayKey={dayKey} />
            </span>
          </h2>
          <ul>
            {list.map((booking) => (
              <li key={booking.id}>
                <a
                  href="#"
                  className="flex min-h-[64px] items-start gap-3 border-b border-[var(--vb-border)] px-4 py-3 active:bg-[var(--vb-hover)]"
                >
                  <div className="vb-num w-[64px] shrink-0 whitespace-nowrap pt-px">
                    <div className="text-[13px] font-medium">
                      {formatTime(booking.start)}
                    </div>
                    <div className="text-[12px] text-[var(--vb-text-3)]">
                      {booking.durationMin} min
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`truncate text-[14px] font-medium ${booking.status === "Cancelled" ? "text-[var(--vb-text-3)] line-through" : ""}`}
                      >
                        {booking.child}
                      </span>
                      {booking.kind === "Evaluation" && (
                        <KindLabel kind={booking.kind} />
                      )}
                    </div>
                    <div className="mt-0.5 truncate text-[13px] text-[var(--vb-text-2)]">
                      {booking.subject} · {booking.level} · {booking.tutor}
                    </div>
                  </div>
                  <StatusBadge status={booking.status} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bookings calendar

function BookingsCalendar(): React.ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(
    getNextBooking(bookings)?.id ?? null,
  );
  const [phoneDay, setPhoneDay] = useState(today);
  const selected = bookings.find((booking) => booking.id === selectedId) ?? null;

  return (
    <>
      <div className="hidden shrink-0 items-center gap-3 border-b border-[var(--vb-border)] px-5 py-2 md:flex">
        <WeekPager />
        <CalendarLegend />
      </div>
      <WeekGrid selectedId={selectedId} onSelect={setSelectedId} />
      <PhoneDayView
        day={phoneDay}
        onChangeDay={setPhoneDay}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
      {selected && (
        <>
          <aside
            aria-label="Booking details"
            className="vb-slide-in absolute inset-y-0 right-0 z-30 hidden w-[400px] flex-col border-l border-[var(--vb-border)] bg-[var(--vb-surface)] shadow-[var(--vb-shadow-overlay)] md:flex"
          >
            <BookingDetail
              booking={selected}
              onClose={() => setSelectedId(null)}
            />
          </aside>
          <div className="absolute inset-0 z-30 flex flex-col justify-end md:hidden">
            <button
              type="button"
              aria-label="Close details"
              onClick={() => setSelectedId(null)}
              className="absolute inset-0 bg-[var(--vb-scrim)]"
            />
            <div
              role="dialog"
              aria-label="Booking details"
              className="vb-sheet-in relative flex max-h-[62%] flex-col rounded-t-[var(--vb-radius-lg)] bg-[var(--vb-surface)] shadow-[var(--vb-shadow-overlay)]"
            >
              <span
                className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-[var(--vb-border-strong)]"
                aria-hidden
              />
              <BookingDetail
                booking={selected}
                onClose={() => setSelectedId(null)}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function CalendarLegend(): React.ReactNode {
  return (
    <div className="ml-auto flex items-center gap-4 text-[12px] text-[var(--vb-text-2)]">
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-3 w-1 rounded-sm bg-[var(--vb-tutoring-bar)]"
          aria-hidden
        />
        Tutoring
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="size-2 rotate-45 bg-[var(--vb-eval-bar)]"
          aria-hidden
        />
        Evaluation
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span
          className="vb-hatch h-3 w-3 rounded-sm border border-[var(--vb-border-strong)]"
          aria-hidden
        />
        Cancelled
      </span>
    </div>
  );
}

type CalendarSelectionProps = {
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function WeekGrid({ selectedId, onSelect }: CalendarSelectionProps): React.ReactNode {
  const days = getWeekDays();
  const gridColumns = "56px repeat(7, minmax(0, 1fr))";
  return (
    <div className="vb-scroll hidden min-h-0 flex-1 flex-col overflow-auto md:flex">
      <div
        className="sticky top-0 z-20 grid shrink-0 border-b border-[var(--vb-border)] bg-[var(--vb-surface)]"
        style={{ gridTemplateColumns: gridColumns }}
      >
        <span />
        {days.map((dayKey) => (
          <WeekDayHeader key={dayKey} dayKey={dayKey} />
        ))}
      </div>
      <div
        className="relative grid shrink-0"
        style={{
          gridTemplateColumns: gridColumns,
          height: HOURS.length * WEEK_HOUR_PX,
        }}
      >
        <HourGutter hourPx={WEEK_HOUR_PX} />
        {days.map((dayKey) => (
          <DayColumn
            key={dayKey}
            dayKey={dayKey}
            hourPx={WEEK_HOUR_PX}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function WeekDayHeader({ dayKey }: { dayKey: string }): React.ReactNode {
  const isToday = dayKey === today;
  const date = new Date(`${dayKey}T00:00:00`);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  return (
    <div className="flex h-11 items-center gap-1.5 border-l border-[var(--vb-border)] px-2.5">
      <span
        className={`text-[12px] font-medium ${isToday ? "text-[var(--vb-selected-text)]" : "text-[var(--vb-text-3)]"}`}
      >
        {weekday}
      </span>
      <span
        className={`vb-num inline-flex h-6 min-w-6 items-center justify-center rounded-[var(--vb-radius)] px-1 text-[14px] font-semibold ${isToday ? "bg-[var(--vb-accent)] text-[var(--vb-on-accent)]" : ""}`}
        aria-current={isToday ? "date" : undefined}
      >
        {date.getDate()}
      </span>
    </div>
  );
}

function HourGutter({ hourPx }: { hourPx: number }): React.ReactNode {
  return (
    <div className="relative" aria-hidden>
      {HOURS.slice(1).map((hour, index) => (
        <span
          key={hour}
          className="vb-num absolute right-2 -translate-y-1/2 text-[11px] text-[var(--vb-text-3)]"
          style={{ top: (index + 1) * hourPx }}
        >
          {formatHour(hour)}
        </span>
      ))}
    </div>
  );
}

function DayColumn({
  dayKey,
  hourPx,
  selectedId,
  onSelect,
}: CalendarSelectionProps & {
  dayKey: string;
  hourPx: number;
}): React.ReactNode {
  const isToday = dayKey === today;
  const placed = placeBookings(
    bookings.filter((booking) => getDayKey(booking.start) === dayKey),
  );
  const nowTop =
    ((getMinutesIntoDay(NOW) - DAY_START_HOUR * MINUTES_PER_HOUR) /
      MINUTES_PER_HOUR) *
    hourPx;
  return (
    <div
      className={`relative border-l border-[var(--vb-border)] ${isToday ? "bg-[var(--vb-today-column)]" : ""}`}
    >
      {HOURS.slice(1).map((hour, index) => (
        <span
          key={hour}
          className="absolute inset-x-0 border-t border-[var(--vb-border)]"
          style={{ top: (index + 1) * hourPx }}
          aria-hidden
        />
      ))}
      {placed.map((item) => (
        <CalendarBlock
          key={item.booking.id}
          item={item}
          hourPx={hourPx}
          isSelected={item.booking.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      {isToday && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
          style={{ top: nowTop }}
          aria-label={`Now, ${formatTime(NOW)}`}
        >
          <span className="-ml-1 size-2 rounded-full bg-[var(--vb-focus)]" />
          <span className="h-0.5 flex-1 bg-[var(--vb-focus)]" />
        </div>
      )}
    </div>
  );
}

function CalendarBlock({
  item,
  hourPx,
  isSelected,
  onSelect,
}: {
  item: PlacedBooking;
  hourPx: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const { booking, lane, laneCount } = item;
  const { top, height } = getBlockGeometry(booking, hourPx);
  const isEvaluation = booking.kind === "Evaluation";
  const isCancelled = booking.status === "Cancelled";
  const isPending = booking.status === "Pending";
  const widthPct = 100 / laneCount;

  let surfaceClass =
    "bg-[var(--vb-tutoring-bg)] border-l-[var(--vb-tutoring-bar)]";
  if (isCancelled) {
    surfaceClass = "vb-hatch bg-[var(--vb-surface)] border-l-[var(--vb-border-strong)]";
  } else if (isEvaluation) {
    surfaceClass =
      "bg-[var(--vb-eval-bg)] border-l-[var(--vb-eval-bar)] ring-1 ring-inset ring-[var(--vb-border)]";
  }
  const pendingClass = isPending
    ? "outline-1 outline-dashed outline-[var(--vb-warning-fg)] -outline-offset-1"
    : "";
  const selectedClass = isSelected
    ? "z-10 outline-2 outline-solid outline-[var(--vb-focus)] outline-offset-1"
    : "";

  return (
    <button
      type="button"
      onClick={() => onSelect(booking.id)}
      aria-pressed={isSelected}
      aria-label={`${booking.kind}: ${booking.child}, ${formatTimeRange(booking)}, ${booking.status}`}
      className={`absolute overflow-hidden rounded-[var(--vb-radius)] border-l-[3px] px-1.5 py-1 text-left text-[12px] leading-[16px] ${surfaceClass} ${pendingClass} ${selectedClass}`}
      style={{
        top: top + 1,
        height: height - 2,
        left: `calc(${lane * widthPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
      }}
    >
      <span className="flex items-center gap-1">
        {isEvaluation && (
          <span
            className="size-1.5 shrink-0 rotate-45 bg-[var(--vb-eval-bar)]"
            aria-hidden
          />
        )}
        <span
          className={`truncate font-medium ${isCancelled ? "text-[var(--vb-text-3)] line-through" : ""}`}
        >
          {booking.child}
        </span>
      </span>
      <span className="vb-num block truncate text-[var(--vb-text-2)]">
        {formatTime(booking.start)} · {booking.tutor}
      </span>
      {height >= MIN_BLOCK_FOR_THIRD_LINE_PX && (
        <span className="block truncate text-[var(--vb-text-3)]">
          {isEvaluation ? "Evaluation" : booking.subject}
          {isPending ? " · Pending" : ""}
        </span>
      )}
    </button>
  );
}

function PhoneDayView({
  day,
  onChangeDay,
  selectedId,
  onSelect,
}: CalendarSelectionProps & {
  day: string;
  onChangeDay: (day: string) => void;
}): React.ReactNode {
  const days = getWeekDays();
  return (
    <div className="flex min-h-0 flex-1 flex-col md:hidden">
      <div className="flex shrink-0 justify-between border-b border-[var(--vb-border)] px-2 py-1.5">
        {days.map((dayKey) => {
          const date = new Date(`${dayKey}T00:00:00`);
          const isActive = dayKey === day;
          const isToday = dayKey === today;
          let stateClass = "text-[var(--vb-text)]";
          if (isActive) {
            stateClass = "bg-[var(--vb-accent)] text-[var(--vb-on-accent)]";
          } else if (isToday) {
            stateClass = "text-[var(--vb-selected-text)]";
          }
          return (
            <button
              key={dayKey}
              type="button"
              onClick={() => onChangeDay(dayKey)}
              aria-pressed={isActive}
              aria-label={formatDay(dayKey, true)}
              className={`flex h-12 w-11 flex-col items-center justify-center rounded-[var(--vb-radius)] ${stateClass}`}
            >
              <span className="text-[12px] opacity-80">
                {date.toLocaleDateString("en-US", { weekday: "narrow" })}
              </span>
              <span className="vb-num text-[15px] font-semibold">
                {date.getDate()}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between px-4 text-[13px]">
        <span className="font-semibold">
          <DayHeading dayKey={day} />
        </span>
        <span className="text-[12px] text-[var(--vb-text-3)]">
          {bookings.filter((booking) => getDayKey(booking.start) === day).length}{" "}
          bookings
        </span>
      </div>
      <div className="vb-scroll min-h-0 flex-1 overflow-auto">
        <div
          className="relative grid"
          style={{
            gridTemplateColumns: "52px minmax(0, 1fr)",
            height: HOURS.length * DAY_HOUR_PX,
          }}
        >
          <HourGutter hourPx={DAY_HOUR_PX} />
          <DayColumn
            dayKey={day}
            hourPx={DAY_HOUR_PX}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </div>
      </div>
    </div>
  );
}

function BookingDetail({
  booking,
  onClose,
}: {
  booking: Booking;
  onClose: () => void;
}): React.ReactNode {
  const isLive = booking.status !== "Cancelled" && booking.status !== "Completed";
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-4 pt-3">
        <KindLabel kind={booking.kind} />
        <StatusBadge status={booking.status} />
        <span className="ml-auto">
          <IconButton icon={X} label="Close details" onClick={onClose} />
        </span>
      </div>
      <div className="vb-scroll min-h-0 flex-1 overflow-auto px-4 pb-4">
        <h2 className="mt-2 text-[16px] font-semibold">{booking.child}</h2>
        <p className="vb-num mt-0.5 text-[13px] text-[var(--vb-text-2)]">
          {formatDay(getDayKey(booking.start))} · {formatTimeRange(booking)}
        </p>
        <dl className="mt-4 grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[13px]">
          <DetailField label="Tutor">
            <span className="inline-flex items-center gap-2">
              <Avatar name={booking.tutor} />
              {booking.tutor}
            </span>
          </DetailField>
          <DetailField label="Guardian">{booking.guardian}</DetailField>
          <DetailField label="Subject level">
            {booking.subject} · {booking.level}
          </DetailField>
          <DetailField label="Duration">{booking.durationMin} min</DetailField>
          <DetailField label="Location">
            <span className="block">{booking.location}</span>
            {booking.directions && (
              <span className="mt-0.5 block text-[var(--vb-text-3)]">
                {booking.directions}
              </span>
            )}
          </DetailField>
        </dl>
        <div className="mt-4 border-t border-[var(--vb-border)] pt-3">
          <h3 className="text-[12px] font-medium text-[var(--vb-text-3)]">
            Child notes
          </h3>
          <p className="mt-1.5 text-[13px] text-[var(--vb-text)]">
            {booking.childNotes ?? (
              <span className="text-[var(--vb-text-3)]">No notes yet.</span>
            )}
          </p>
        </div>
        <p className="mt-4 text-[12px] text-[var(--vb-text-3)]">
          Booked by {booking.guardian} in chat · Oct 9
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--vb-border)] px-4 py-3">
        {isLive && (
          <button type="button" className="vb-btn vb-btn-primary h-10 md:h-[30px]">
            Change booking
          </button>
        )}
        <button type="button" className="vb-btn h-10 md:h-[30px]">
          <MessagesSquare size={14} aria-hidden />
          Open chat
        </button>
        {isLive && (
          <button
            type="button"
            className="vb-btn vb-btn-danger ml-auto h-10 md:h-[30px]"
          >
            Cancel booking
          </button>
        )}
      </div>
    </>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <>
      <dt className="text-[var(--vb-text-3)]">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tutor: My sessions (phone)

function TutorScreen({ onOpenTokens }: { onOpenTokens: () => void }): React.ReactNode {
  const todaySessions = tutorSessions.filter(
    (session) => getDayKey(session.start) === today,
  );
  const upcomingGroups = groupByDay(
    tutorSessions.filter((session) => getDayKey(session.start) > today),
  );
  const nextSession = getNextBooking(todaySessions);
  const [expandedId, setExpandedId] = useState<string | null>(
    nextSession?.id ?? null,
  );
  const firstFutureIndex = todaySessions.findIndex(
    (session) => !isPast(session),
  );

  function handleToggle(id: string): void {
    setExpandedId((current) => (current === id ? null : id));
  }

  return (
    <>
      <header className="shrink-0 border-b border-[var(--vb-border)] bg-[var(--vb-surface)] px-4 pb-3 pt-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={currentTutor} size={28} />
          <h1 className="vb-display flex-1 text-[20px] font-semibold">
            My sessions
          </h1>
          <IconButton
            icon={SwatchBook}
            label="Design tokens"
            onClick={onOpenTokens}
            isTouchOnly
          />
        </div>
        <p className="vb-num mt-0.5 text-[13px] text-[var(--vb-text-2)]">
          {formatDay(today, true)}
          {nextSession && (
            <>
              {" · "}
              <span className="text-[var(--vb-text)]">
                Next at {formatTime(nextSession.start)}
              </span>
            </>
          )}
        </p>
      </header>
      <div className="vb-scroll min-h-0 flex-1 overflow-auto bg-[var(--vb-surface)]">
        <SessionGroupHeading
          label="Today"
          count={todaySessions.length}
        />
        <ul>
          {todaySessions.map((session, index) => (
            <li key={session.id}>
              {index === firstFutureIndex && <NowDivider />}
              <SessionRow
                session={session}
                isExpanded={session.id === expandedId}
                onToggle={handleToggle}
              />
            </li>
          ))}
        </ul>
        {upcomingGroups.map(([dayKey, list]) => (
          <section key={dayKey}>
            <SessionGroupHeading label={formatDay(dayKey)} count={list.length} />
            <ul>
              {list.map((session) => (
                <li key={session.id}>
                  <SessionRow
                    session={session}
                    isExpanded={session.id === expandedId}
                    onToggle={handleToggle}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="px-4 py-6 text-center text-[12px] text-[var(--vb-text-3)]">
          That’s everything booked through Oct 18.
        </p>
      </div>
      <BottomTabs items={TUTOR_NAV} active="My sessions" isAlwaysVisible />
    </>
  );
}

function SessionGroupHeading({
  label,
  count,
}: {
  label: string;
  count: number;
}): React.ReactNode {
  return (
    <h2 className="sticky top-0 z-10 flex h-9 items-center justify-between border-b border-[var(--vb-border)] bg-[var(--vb-subtle)] px-4 text-[13px] font-semibold">
      <span className="vb-num">{label}</span>
      <span className="vb-num text-[12px] font-normal text-[var(--vb-text-3)]">
        {count} {count === 1 ? "session" : "sessions"}
      </span>
    </h2>
  );
}

function NowDivider(): React.ReactNode {
  return (
    <div
      className="flex items-center gap-2 px-4 py-1"
      aria-label={`Now, ${formatTime(NOW)}`}
    >
      <span className="vb-num text-[12px] font-semibold text-[var(--vb-link)]">
        Now · {formatTime(NOW)}
      </span>
      <span className="h-px flex-1 bg-[var(--vb-focus)]" aria-hidden />
    </div>
  );
}

function SessionRow({
  session,
  isExpanded,
  onToggle,
}: {
  session: Booking;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}): React.ReactNode {
  const isEarlier = isPast(session);
  const panelId = `vb-session-${session.id}`;
  return (
    <div
      className={`border-b border-[var(--vb-border)] ${isExpanded ? "bg-[var(--vb-selected)]" : ""}`}
    >
      <button
        type="button"
        onClick={() => onToggle(session.id)}
        aria-expanded={isExpanded}
        aria-controls={panelId}
        className="flex min-h-[68px] w-full items-start gap-3 px-4 py-3 text-left"
      >
        <div className="vb-num w-[68px] shrink-0 whitespace-nowrap">
          <div
            className={`text-[14px] font-semibold ${isEarlier ? "text-[var(--vb-text-3)]" : ""}`}
          >
            {formatTime(session.start)}
          </div>
          <div className="text-[12px] text-[var(--vb-text-3)]">
            {session.durationMin} min
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`truncate text-[15px] font-medium ${isEarlier ? "text-[var(--vb-text-2)]" : ""}`}
            >
              {session.child}
            </span>
            {session.kind === "Evaluation" && <KindLabel kind={session.kind} />}
          </div>
          <div className="mt-0.5 text-[13px] text-[var(--vb-text-2)]">
            {session.subject} · {session.level}
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--vb-text-3)]">
            <LocationLine location={session.location} isShort />
          </div>
        </div>
        <span className="flex flex-col items-end gap-2">
          {session.status !== "Upcoming" && (
            <StatusBadge status={session.status} />
          )}
          <ChevronDown
            size={18}
            className={`text-[var(--vb-text-3)] transition-transform duration-150 ${isExpanded ? "rotate-180" : ""}`}
            aria-hidden
          />
        </span>
      </button>
      {isExpanded && (
        <SessionDetails session={session} panelId={panelId} />
      )}
    </div>
  );
}

function SessionDetails({
  session,
  panelId,
}: {
  session: Booking;
  panelId: string;
}): React.ReactNode {
  const isOffice = session.location === "In office";
  return (
    <div id={panelId} className="flex flex-col gap-3 px-4 pb-4">
      <div className="rounded-[var(--vb-radius-lg)] border border-[var(--vb-border)] bg-[var(--vb-surface)]">
        <SessionDetailBlock label="Subject level">
          {session.subject} · {session.level}
        </SessionDetailBlock>
        <SessionDetailBlock label="Child notes" icon={StickyNote}>
          {session.childNotes ?? (
            <span className="text-[var(--vb-text-3)]">No notes yet.</span>
          )}
        </SessionDetailBlock>
        <SessionDetailBlock
          label="Location"
          icon={isOffice ? Building2 : MapPin}
        >
          <span className="block">{session.location}</span>
          {session.directions && (
            <span className="mt-0.5 block text-[var(--vb-text-2)]">
              {session.directions}
            </span>
          )}
        </SessionDetailBlock>
        <SessionDetailBlock label="Guardian">
          <span className="block">{session.guardian}</span>
          <span className="mt-0.5 block text-[var(--vb-text-2)]">
            Reach them through the office.
          </span>
        </SessionDetailBlock>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="vb-btn vb-btn-lg"
          disabled={isOffice}
        >
          <Navigation size={16} aria-hidden />
          {isOffice ? "In office" : "Directions"}
        </button>
        <button type="button" className="vb-btn vb-btn-primary vb-btn-lg">
          <MessageSquare size={16} aria-hidden />
          Message office
        </button>
      </div>
    </div>
  );
}

function SessionDetailBlock({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <div className="border-b border-[var(--vb-border)] px-3 py-2.5 last:border-b-0">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--vb-text-3)]">
        {Icon && <Icon size={13} aria-hidden />}
        {label}
      </div>
      <div className="mt-1 text-[14px] leading-[20px]">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spec strip

type Swatch = { name: string; token: string; light: string; dark: string };

const ACCENT_RAMP: Swatch[] = [
  ["50", "#E8F4F8"],
  ["100", "#D3EBF3"],
  ["200 brand", "#ADD8E6"],
  ["400", "#5FA9C2"],
  ["600", "#1F6F8B"],
  ["700", "#175A72"],
  ["800", "#0F4357"],
].map(([name, hex]) => ({
  name,
  token: `--vb-blue-${name.split(" ")[0]}`,
  light: hex,
  dark: hex,
}));

const ROLE_SWATCHES: Swatch[] = [
  { name: "accent fill", token: "--vb-accent", light: "#1F6F8B", dark: "#ADD8E6" },
  { name: "link", token: "--vb-link", light: "#175A72", dark: "#7CC4DC" },
  { name: "focus", token: "--vb-focus", light: "#1F6F8B", dark: "#7CC4DC" },
  { name: "selected", token: "--vb-selected", light: "#E8F4F8", dark: "#17303A" },
];

const NEUTRAL_SWATCHES: Swatch[] = [
  { name: "canvas", token: "--vb-canvas", light: "#F7F8FA", dark: "#0F1113" },
  { name: "surface", token: "--vb-surface", light: "#FFFFFF", dark: "#16191C" },
  { name: "subtle", token: "--vb-subtle", light: "#F1F3F5", dark: "#1C2024" },
  { name: "hover", token: "--vb-hover", light: "#EEF1F4", dark: "#20252A" },
  { name: "border", token: "--vb-border", light: "#E3E7EB", dark: "#262B31" },
  { name: "border strong", token: "--vb-border-strong", light: "#CDD3D9", dark: "#363C44" },
  { name: "text 3", token: "--vb-text-3", light: "#636E7A", dark: "#8A939D" },
  { name: "text 2", token: "--vb-text-2", light: "#4A5561", dark: "#A9B1BA" },
  { name: "text", token: "--vb-text", light: "#14191F", dark: "#E8EBEE" },
];

const STATUS_SPECS: { status: BookingStatus; light: string; dark: string }[] = [
  { status: "Upcoming", light: "#175A72 / #E8F4F8", dark: "#8FD0E6 / #142A33" },
  { status: "Completed", light: "#1E6B3E / #E6F4EC", dark: "#7FD3A0 / #15291E" },
  { status: "Pending", light: "#8A5300 / #FBF0DC", dark: "#F0B865 / #2E2210" },
  { status: "Cancelled", light: "#B42330 / #FBE9EA", dark: "#F59AA0 / #33171A" },
  { status: "Taken over", light: "#4A5561 / #EEF1F4", dark: "#A9B1BA / #23282D" },
];

const PASTEL_SWATCHES: Swatch[] = [
  ["blue", "#ADD8E6"],
  ["pink", "#FFC0CB"],
  ["yellow", "#FFFACD"],
  ["green", "#B8F0B8"],
  ["mauve", "#E5D4E3"],
].map(([name, hex]) => ({
  name,
  token: `--vb-pastel-${name}`,
  light: hex,
  dark: hex,
}));

const TYPE_SCALE: { label: string; spec: string; className: string }[] = [
  { label: "Page title", spec: "Lato 600 · 20/28", className: "vb-display text-[20px] leading-[28px] font-semibold" },
  { label: "Panel title", spec: "Inter 600 · 16/24", className: "text-[16px] leading-[24px] font-semibold" },
  { label: "Body", spec: "Inter 400 · 14/20", className: "text-[14px] leading-[20px]" },
  { label: "Table 3:30 PM", spec: "Inter 400 · 13/18 · tnum", className: "vb-num text-[13px] leading-[18px]" },
  { label: "Meta and badges", spec: "Inter 500 · 12/16", className: "text-[12px] leading-[16px] font-medium" },
];

const SHAPE_SPECS: { label: string; detail: string }[] = [
  { label: "Radius", detail: "4 chips · 6 controls, blocks · 8 panels, sheets · pill for status badges only" },
  { label: "Borders", detail: "1px hairlines (border) for dividers, border strong for controls" },
  { label: "Elevation", detail: "Flat everywhere; one overlay shadow for slide-over, sheet, this panel" },
  { label: "Density", detail: "Rows 36px desktop, 64px phone · controls 30px, 44px touch · sidebar 220px" },
  { label: "Focus", detail: "2px solid focus ring, 1px offset, AA against every surface" },
];

function SpecPanel({
  theme,
  isCompact,
  onClose,
}: {
  theme: Theme;
  isCompact: boolean;
  onClose: () => void;
}): React.ReactNode {
  const placementClass = isCompact
    ? ""
    : "sm:left-auto sm:right-4 sm:top-14 sm:w-[560px] sm:max-h-[calc(100%-120px)]";
  return (
    <div
      role="dialog"
      aria-label="Design tokens"
      className={`vb-slide-in vb-scroll absolute inset-x-2 top-2 z-50 max-h-[calc(100%-16px)] overflow-auto rounded-[var(--vb-radius-lg)] border border-[var(--vb-border)] bg-[var(--vb-surface)] shadow-[var(--vb-shadow-overlay)] ${placementClass}`}
    >
      <div className="sticky top-0 flex items-center gap-2 border-b border-[var(--vb-border)] bg-[var(--vb-surface)] px-4 py-2">
        <SwatchBook size={15} aria-hidden />
        <h2 className="text-[14px] font-semibold">
          Calm product · tokens ({theme})
        </h2>
        <span className="ml-auto">
          <IconButton
            icon={X}
            label="Close tokens"
            onClick={onClose}
            isTouchOnly={isCompact}
          />
        </span>
      </div>
      <div className="flex flex-col gap-4 p-4 text-[12px]">
        <SpecSection title="Accent ramp (from #ADD8E6, hue 195)">
          <SwatchRow swatches={ACCENT_RAMP} theme={theme} />
        </SpecSection>
        <SpecSection title="Accent roles">
          <SwatchRow swatches={ROLE_SWATCHES} theme={theme} />
        </SpecSection>
        <SpecSection title="Neutrals (cool, hue ~205)">
          <SwatchRow swatches={NEUTRAL_SWATCHES} theme={theme} />
        </SpecSection>
        <SpecSection title="Status (text / fill)">
          <div className="flex flex-col gap-1.5">
            {STATUS_SPECS.map((spec) => (
              <div key={spec.status} className="flex items-center gap-3">
                <span className="w-28">
                  <StatusBadge status={spec.status} />
                </span>
                <span className="vb-num text-[var(--vb-text-3)]">
                  {theme === "light" ? spec.light : spec.dark}
                </span>
              </div>
            ))}
          </div>
        </SpecSection>
        <SpecSection title="Brand pastels (avatars, Evaluation marker only)">
          <div className="flex items-center gap-3">
            <SwatchRow swatches={PASTEL_SWATCHES} theme={theme} />
            <KindLabel kind="Evaluation" />
          </div>
        </SpecSection>
        <SpecSection title="Type">
          <div className="flex flex-col gap-1.5">
            {TYPE_SCALE.map((row) => (
              <div key={row.label} className="flex items-baseline gap-3">
                <span className={`min-w-0 flex-1 truncate ${row.className}`}>
                  {row.label}
                </span>
                <span className="shrink-0 text-[var(--vb-text-3)]">
                  {row.spec}
                </span>
              </div>
            ))}
          </div>
        </SpecSection>
        <SpecSection title="Shape and density">
          <dl className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            {SHAPE_SPECS.map((spec) => (
              <DetailField key={spec.label} label={spec.label}>
                {spec.detail}
              </DetailField>
            ))}
          </dl>
          <div className="mt-2 flex items-end gap-2">
            {["4px", "6px", "8px", "999px"].map((radius) => (
              <span
                key={radius}
                className="vb-num flex h-9 w-14 items-center justify-center border border-[var(--vb-border-strong)] bg-[var(--vb-subtle)] text-[11px] text-[var(--vb-text-2)]"
                style={{ borderRadius: radius }}
              >
                {radius === "999px" ? "pill" : radius}
              </span>
            ))}
          </div>
        </SpecSection>
      </div>
    </div>
  );
}

function SpecSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <section>
      <h3 className="mb-1.5 text-[12px] font-medium text-[var(--vb-text-3)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

function SwatchRow({
  swatches,
  theme,
}: {
  swatches: Swatch[];
  theme: Theme;
}): React.ReactNode {
  return (
    <div className="flex flex-wrap gap-2">
      {swatches.map((swatch) => (
        <div key={swatch.name} className="w-[58px]">
          <span
            className="block h-8 rounded-[var(--vb-radius)] border border-[var(--vb-border)]"
            style={{ background: `var(${swatch.token})` }}
          />
          <span className="mt-1 block truncate text-[11px] text-[var(--vb-text-2)]">
            {swatch.name}
          </span>
          <span className="vb-num block text-[11px] text-[var(--vb-text-3)]">
            {theme === "light" ? swatch.light : swatch.dark}
          </span>
        </div>
      ))}
    </div>
  );
}
