// Variant A, "Faithful pastel": as close to the public M's Helping Hands
// site as a working tool allows. Light blue leads, pink/yellow/green
// pastels are accents, Lato light for display, Inter for everything else,
// pills and soft round cards. Throwaway prototype for TutorLink#187.
import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  BookOpen,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Ellipsis,
  HandHeart,
  House,
  List,
  MapPin,
  MessageCircle,
  Navigation,
  NotebookPen,
  Palette,
  Plane,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  bookings,
  currentTutor,
  today,
  todo,
  tutorSessions,
  weekStart,
} from "./mockData";
import type {
  Booking,
  BookingKind,
  BookingStatus,
  Theme,
  TodoItem,
  VariantProps,
} from "./mockData";
import "./variantA.css";

export const variantName = "Faithful pastel";

// ---------------------------------------------------------------------------
// Tokens. One source for both the inline CSS variables and the spec strip.
// ---------------------------------------------------------------------------

const LIGHT = {
  canvas: "#F4F9FB",
  surface: "#FFFFFF",
  "surface-sunk": "#EEF5F8",
  tint: "#E8F4F8",
  "tint-strong": "#D6EDF5",
  hero: "#ADD8E6",
  primary: "#1F6F8B",
  "primary-hover": "#175A72",
  "on-primary": "#FFFFFF",
  link: "#175A72",
  "primary-ink": "#0F4C61",
  ink: "#14212E",
  "ink-soft": "#334155",
  muted: "#5A6B7B",
  border: "#DCE8EF",
  "card-border": "#E6EFF4",
  focus: "#1F6F8B",
  "on-hero": "#0F4C61",
  pink: "#FFC0CB",
  "pink-tint": "#FFE5EC",
  "pink-ink": "#8A2846",
  yellow: "#FFFACD",
  "yellow-tint": "#FFFBE0",
  "yellow-ink": "#6B5300",
  green: "#B8F0B8",
  "green-tint": "#E8F8E8",
  "green-ink": "#1E6B34",
  success: "#1E7A43",
  "success-tint": "#E3F6E8",
  warning: "#8A5A00",
  "warning-tint": "#FFF2CC",
  danger: "#B42335",
  "danger-tint": "#FFE5EA",
  info: "#175A72",
  "info-tint": "#E1F1F7",
  neutral: "#4B5B6A",
  "neutral-tint": "#EDF2F5",
  "today-col": "rgba(232, 244, 248, 0.7)",
  glow: "rgba(173, 216, 230, 0.45)",
  "glow-pink": "rgba(255, 192, 203, 0.22)",
  hatch: "rgba(90, 107, 123, 0.16)",
  scrim: "rgba(20, 33, 46, 0.32)",
  "shadow-soft":
    "0 1px 2px rgba(20, 33, 46, 0.04), 0 10px 30px -12px rgba(31, 111, 139, 0.18)",
  "shadow-raised":
    "0 2px 6px rgba(20, 33, 46, 0.05), 0 28px 56px -20px rgba(31, 111, 139, 0.34)",
};

type TokenName = keyof typeof LIGHT;

const DARK: Record<TokenName, string> = {
  canvas: "#0E1A26",
  surface: "#152433",
  "surface-sunk": "#11202E",
  tint: "#1B2E40",
  "tint-strong": "#233D50",
  hero: "#ADD8E6",
  primary: "#ADD8E6",
  "primary-hover": "#C6E6F0",
  "on-primary": "#0B1724",
  link: "#ADD8E6",
  "primary-ink": "#CDEAF3",
  ink: "#E6F0F5",
  "ink-soft": "#C4D3DD",
  muted: "#9DB3C2",
  border: "#26394C",
  "card-border": "#22364A",
  focus: "#ADD8E6",
  "on-hero": "#0F4C61",
  pink: "#FFC0CB",
  "pink-tint": "#3A2633",
  "pink-ink": "#FFC0CB",
  yellow: "#FFFACD",
  "yellow-tint": "#33301E",
  "yellow-ink": "#FFF3A6",
  green: "#B8F0B8",
  "green-tint": "#17302A",
  "green-ink": "#B8F0B8",
  success: "#8FE3A8",
  "success-tint": "#17302A",
  warning: "#FFE08A",
  "warning-tint": "#33301E",
  danger: "#FF9FAE",
  "danger-tint": "#3A2230",
  info: "#ADD8E6",
  "info-tint": "#1D3647",
  neutral: "#B7C5D0",
  "neutral-tint": "#243442",
  "today-col": "rgba(173, 216, 230, 0.05)",
  glow: "rgba(173, 216, 230, 0.10)",
  "glow-pink": "rgba(255, 192, 203, 0.05)",
  hatch: "rgba(157, 179, 194, 0.16)",
  scrim: "rgba(4, 10, 16, 0.6)",
  "shadow-soft":
    "0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 12px 32px -14px rgba(0, 0, 0, 0.55)",
  "shadow-raised":
    "0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 30px 60px -20px rgba(0, 0, 0, 0.7)",
};

const TOKENS: Record<Theme, Record<TokenName, string>> = {
  light: LIGHT,
  dark: DARK,
};

// The brand hue (195deg) as a ramp; 200 is the site's lightBlue.
const PRIMARY_RAMP = [
  ["50", "#E8F4F8"],
  ["100", "#D6EDF5"],
  ["200", "#ADD8E6"],
  ["300", "#7FBFD4"],
  ["400", "#559FB9"],
  ["500", "#3E8FAC"],
  ["600", "#1F6F8B"],
  ["700", "#175A72"],
  ["800", "#0F4C61"],
  ["900", "#0A3646"],
] as const;

function getTokenStyle(theme: Theme): CSSProperties {
  const entries = Object.entries(TOKENS[theme]).map(([name, value]) => [
    `--va-${name}`,
    value,
  ]);
  // CSSProperties has no index for custom properties; every key is --va-*.
  return Object.fromEntries(entries) as CSSProperties;
}

// ---------------------------------------------------------------------------
// Time and data helpers
// ---------------------------------------------------------------------------

const NOW = "2026-10-13T08:40:00";
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;
const MINUTES_PER_HOUR = 60;
const WEEK_LENGTH = 7;
const NOON = 12;
const EVENING = 17;
const HOUR_PX_WEEK = 56;
const HOUR_PX_DAY = 64;
const DEFAULT_SELECTED_ID = "b05";
const OFFICE_USER = { first: "Maria", full: "Maria Lopez", role: "Admin" };
const OFFICE_TODO_COUNT = todo.length;
const CHATS_UNREAD = 2;

function toDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function shiftDayKey(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return toDayKey(new Date(year, month - 1, day + days));
}

function getDayKey(iso: string): string {
  return iso.slice(0, 10);
}

function formatDay(
  dayKey: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return new Date(`${dayKey}T12:00:00`).toLocaleDateString("en-US", options);
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function getEnd(booking: Booking): Date {
  const start = new Date(booking.start);
  return new Date(start.getTime() + booking.durationMin * 60_000);
}

function formatTimeRange(booking: Booking): string {
  return `${formatTime(new Date(booking.start))} – ${formatTime(getEnd(booking))}`;
}

function getRelativeDayLabel(dayKey: string): string {
  let label = formatDay(dayKey, { weekday: "long" });
  if (dayKey === today) {
    label = "Today";
  } else if (dayKey === shiftDayKey(today, 1)) {
    label = "Tomorrow";
  }
  return label;
}

function getGreeting(iso: string): string {
  const hour = new Date(iso).getHours();
  let greeting = "Good evening";
  if (hour < NOON) {
    greeting = "Good morning";
  } else if (hour < EVENING) {
    greeting = "Good afternoon";
  }
  return greeting;
}

function getMinutesIntoDay(iso: string): number {
  const date = new Date(iso);
  return (
    (date.getHours() - DAY_START_HOUR) * MINUTES_PER_HOUR + date.getMinutes()
  );
}

function getWeekDays(): string[] {
  return Array.from({ length: WEEK_LENGTH }, (_, index) =>
    shiftDayKey(weekStart, index),
  );
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

type DayGroup = { dayKey: string; items: Booking[] };

function groupByDay(list: Booking[]): DayGroup[] {
  const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
  const keys = [...new Set(sorted.map((booking) => getDayKey(booking.start)))];
  return keys.map((dayKey) => ({
    dayKey,
    items: sorted.filter((booking) => getDayKey(booking.start) === dayKey),
  }));
}

type PlacedBooking = { booking: Booking; lane: number; laneCount: number };

// Greedy lane packing per cluster of overlapping bookings, so a booking
// only shares width with the bookings it actually overlaps.
function layoutDay(items: Booking[]): PlacedBooking[] {
  const sorted = [...items].sort((a, b) => a.start.localeCompare(b.start));
  const placed: PlacedBooking[] = [];
  let cluster: { booking: Booking; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = 0;
  const flush = (): void => {
    const laneCount = Math.max(1, laneEnds.length);
    placed.push(...cluster.map((item) => ({ ...item, laneCount })));
  };
  for (const booking of sorted) {
    const start = getMinutesIntoDay(booking.start);
    const end = start + booking.durationMin;
    if (cluster.length > 0 && start >= clusterEnd) {
      flush();
      cluster = [];
      laneEnds = [];
    }
    const freeLane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    const lane = freeLane === -1 ? laneEnds.length : freeLane;
    laneEnds[lane] = end;
    clusterEnd = Math.max(clusterEnd, end);
    cluster.push({ booking, lane });
  }
  flush();
  return placed;
}

function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  info: "bg-[var(--va-info-tint)] text-[var(--va-info)]",
  success: "bg-[var(--va-success-tint)] text-[var(--va-success)]",
  warning: "bg-[var(--va-warning-tint)] text-[var(--va-warning)]",
  danger: "bg-[var(--va-danger-tint)] text-[var(--va-danger)]",
  neutral: "bg-[var(--va-neutral-tint)] text-[var(--va-neutral)]",
};

const STATUS_TONE: Record<BookingStatus, Tone> = {
  Upcoming: "info",
  Completed: "success",
  Pending: "warning",
  Cancelled: "danger",
  "Taken over": "neutral",
};

type KindStyle = { classes: string; dot: string; icon: LucideIcon };

const KIND_STYLE: Record<BookingKind, KindStyle> = {
  Tutoring: {
    classes: "bg-[var(--va-tint-strong)] text-[var(--va-primary-ink)]",
    dot: "bg-[var(--va-hero)]",
    icon: BookOpen,
  },
  Evaluation: {
    classes: "bg-[var(--va-pink-tint)] text-[var(--va-pink-ink)]",
    dot: "bg-[var(--va-pink)]",
    icon: Sparkles,
  },
};

const AVATAR_CLASSES = [
  "bg-[var(--va-tint-strong)] text-[var(--va-primary-ink)]",
  "bg-[var(--va-pink-tint)] text-[var(--va-pink-ink)]",
  "bg-[var(--va-yellow-tint)] text-[var(--va-yellow-ink)]",
  "bg-[var(--va-green-tint)] text-[var(--va-green-ink)]",
];

function getAvatarClasses(name: string): string {
  const sum = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
  return AVATAR_CLASSES[sum % AVATAR_CLASSES.length];
}

type PillProps = { className: string; children: ReactNode };

function Pill({ className, children }: PillProps): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

function KindBadge({ kind }: { kind: BookingKind }): ReactNode {
  const style = KIND_STYLE[kind];
  const Icon = style.icon;
  return (
    <Pill className={style.classes}>
      <Icon aria-hidden className="size-3.5" />
      {kind}
    </Pill>
  );
}

function StatusBadge({ status }: { status: BookingStatus }): ReactNode {
  return (
    <Pill className={TONE_CLASSES[STATUS_TONE[status]]}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {status}
    </Pill>
  );
}

type AvatarProps = { name: string; size?: "sm" | "md" | "lg" };

function Avatar({ name, size = "md" }: AvatarProps): ReactNode {
  const sizes = {
    sm: "size-8 text-[12px]",
    md: "size-10 text-[13px]",
    lg: "size-12 text-[15px]",
  };
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizes[size],
        getAvatarClasses(name),
      )}
    >
      {getInitials(name)}
    </span>
  );
}

const BUTTON_BASE =
  "va-focus inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors duration-150";
const BUTTON_PRIMARY = `${BUTTON_BASE} bg-[var(--va-primary)] text-[var(--va-on-primary)] hover:bg-[var(--va-primary-hover)] va-shadow-soft`;
const BUTTON_SOFT = `${BUTTON_BASE} bg-[var(--va-tint)] text-[var(--va-primary-ink)] hover:bg-[var(--va-tint-strong)]`;
const BUTTON_OUTLINE = `${BUTTON_BASE} border border-[var(--va-border)] bg-[var(--va-surface)] text-[var(--va-ink)] hover:bg-[var(--va-tint)]`;
const BUTTON_DANGER = `${BUTTON_BASE} border border-[var(--va-border)] bg-[var(--va-surface)] text-[var(--va-danger)] hover:bg-[var(--va-danger-tint)]`;
const ICON_BUTTON =
  "va-focus inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--va-ink-soft)] transition-colors duration-150 hover:bg-[var(--va-tint)]";
const CARD =
  "rounded-[20px] border border-[var(--va-card-border)] bg-[var(--va-surface)] va-shadow-soft";
const EYEBROW =
  "text-[12px] font-semibold tracking-[0.14em] text-[var(--va-muted)] uppercase";

function EyebrowPill({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="inline-flex h-7 items-center rounded-full bg-[var(--va-tint)] px-3 text-[12px] font-semibold tracking-[0.14em] text-[var(--va-primary-ink)] uppercase">
      {children}
    </span>
  );
}

type WordmarkProps = { isCompact?: boolean };

function Wordmark({ isCompact = false }: WordmarkProps): ReactNode {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--va-hero)] text-[var(--va-on-hero)]",
          isCompact ? "size-9" : "size-11",
        )}
      >
        <HandHeart className={isCompact ? "size-5" : "size-6"} />
      </span>
      <span className="flex min-w-0 flex-col leading-none">
        <span
          className={cn(
            "va-display font-light whitespace-nowrap text-[var(--va-ink)] uppercase",
            isCompact ? "text-[14px] tracking-[0.06em]" : "text-[15px] tracking-[0.03em]",
          )}
        >
          M&rsquo;s Helping Hands
        </span>
        {!isCompact && (
          <span className="mt-1.5 text-[12px] font-medium text-[var(--va-muted)]">
            TutorLink
          </span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shells
// ---------------------------------------------------------------------------

type NavEntry = { label: string; icon: LucideIcon; badge?: number };

const OFFICE_NAV: NavEntry[] = [
  { label: "Home", icon: House, badge: OFFICE_TODO_COUNT },
  { label: "Bookings", icon: CalendarDays },
  { label: "Chats", icon: MessageCircle, badge: CHATS_UNREAD },
  { label: "People", icon: Users },
  { label: "Settings", icon: Settings },
];

const TUTOR_NAV: NavEntry[] = [
  { label: "My sessions", icon: CalendarDays },
  { label: "My availability", icon: CalendarClock },
  { label: "Time off", icon: Plane },
];

type BottomTabBarProps = {
  items: NavEntry[];
  active: string;
  className?: string;
};

function BottomTabBar({
  items,
  active,
  className,
}: BottomTabBarProps): ReactNode {
  return (
    <nav
      aria-label="Main"
      className={cn(
        "sticky bottom-0 z-20 px-3 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      <ul className="va-shadow-raised flex items-stretch rounded-[28px] border border-[var(--va-card-border)] bg-[var(--va-surface)] p-1.5">
        {items.map((item) => {
          const isActive = item.label === active;
          const Icon = item.icon;
          return (
            <li key={item.label} className="flex-1">
              <a
                href="#"
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "va-focus flex min-h-14 flex-col items-center justify-center gap-1 rounded-[22px] px-1 text-[12px] font-medium",
                  isActive
                    ? "text-[var(--va-primary-ink)]"
                    : "text-[var(--va-muted)]",
                )}
              >
                <span
                  className={cn(
                    "relative inline-flex h-7 w-12 items-center justify-center rounded-full",
                    isActive && "bg-[var(--va-tint-strong)]",
                  )}
                >
                  <Icon aria-hidden className="size-5" />
                  {item.badge ? (
                    <span className="absolute -top-1 right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--va-primary)] px-1 text-[12px] leading-none text-[var(--va-on-primary)] tabular-nums">
                      {item.badge}
                    </span>
                  ) : null}
                </span>
                <span className="text-center leading-tight">{item.label}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Sidebar(): ReactNode {
  return (
    <aside className="sticky top-4 m-4 mr-0 hidden h-[calc(100dvh-32px)] w-[248px] shrink-0 flex-col rounded-[28px] border border-[var(--va-card-border)] bg-[var(--va-surface)] p-4 va-shadow-soft lg:flex">
      <div className="px-2 pt-2 pb-6">
        <Wordmark />
      </div>
      <nav aria-label="Main" className="flex-1">
        <ul className="flex flex-col gap-1">
          {OFFICE_NAV.map((item) => {
            const isActive = item.label === "Bookings";
            const Icon = item.icon;
            return (
              <li key={item.label}>
                <a
                  href="#"
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "va-focus flex h-11 items-center gap-3 rounded-full px-4 text-[14px] transition-colors duration-150",
                    isActive
                      ? "bg-[var(--va-tint-strong)] font-semibold text-[var(--va-primary-ink)]"
                      : "font-medium text-[var(--va-ink-soft)] hover:bg-[var(--va-tint)]",
                  )}
                >
                  <Icon aria-hidden className="size-[18px]" />
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[var(--va-pink-tint)] px-2 text-[12px] font-semibold text-[var(--va-pink-ink)] tabular-nums">
                      {item.badge}
                    </span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="rounded-[20px] bg-[var(--va-tint)] p-3">
        <div className="flex items-center gap-3">
          <Avatar name={OFFICE_USER.full} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">
              {OFFICE_USER.full}
            </p>
            <p className="text-[13px] text-[var(--va-muted)]">
              {OFFICE_USER.role}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function OfficeTopBar(): ReactNode {
  return (
    <header className="flex items-center justify-between gap-4 px-4 pt-4 pb-2 sm:px-6 lg:px-10 lg:pt-8">
      <div className="lg:hidden">
        <Wordmark isCompact />
      </div>
      <div className="hidden lg:block">
        <p className="va-display text-[20px] leading-7 font-normal">
          {getGreeting(NOW)}, {OFFICE_USER.first}
        </p>
        <p className="text-[13px] text-[var(--va-muted)]">
          {formatDay(today, { weekday: "long", month: "long", day: "numeric" })}{" "}
          · Doral, FL
        </p>
      </div>
      <div className="flex items-center gap-2">
        <a
          href="#"
          className="va-focus inline-flex h-11 items-center gap-2 rounded-full bg-[var(--va-pink-tint)] px-4 text-[14px] font-semibold text-[var(--va-pink-ink)]"
        >
          To do
          <span className="inline-flex size-6 items-center justify-center rounded-full bg-[var(--va-surface)] text-[12px] tabular-nums">
            {OFFICE_TODO_COUNT}
          </span>
        </a>
        <span className="hidden sm:inline-flex lg:hidden">
          <Avatar name={OFFICE_USER.full} />
        </span>
      </div>
    </header>
  );
}

type OfficeShellProps = { children: ReactNode };

type ScreenProps = { theme: Theme };

function OfficeShell({ children }: OfficeShellProps): ReactNode {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <OfficeTopBar />
        <main className="flex-1 px-4 pb-6 sm:px-6 lg:px-10 lg:pb-10">
          {children}
        </main>
        <BottomTabBar items={OFFICE_NAV} active="Bookings" className="lg:hidden" />
      </div>
    </div>
  );
}

type BookingsHeaderProps = { view: "list" | "calendar" };

function BookingsHeader({ view }: BookingsHeaderProps): ReactNode {
  const weekBookings = bookings.filter((booking) => booking.status !== "Cancelled");
  const evaluations = weekBookings.filter((booking) => booking.kind === "Evaluation");
  const tabs = [
    { id: "list", label: "List", icon: List },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
  ] as const;
  return (
    <div className="flex flex-col gap-5 pt-4 pb-6 lg:pt-6 lg:pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <EyebrowPill>Week of October 12</EyebrowPill>
          <h1 className="va-display mt-3 text-[34px] leading-[42px] font-light tracking-[-0.01em] lg:text-[44px] lg:leading-[52px]">
            Bookings
          </h1>
          <p className="mt-1 text-[15px] text-[var(--va-muted)]">
            {weekBookings.length} bookings this week, {evaluations.length} of
            them Evaluations.
          </p>
        </div>
        <button type="button" className={BUTTON_PRIMARY}>
          <Plus aria-hidden className="size-[18px]" />
          New booking
        </button>
      </div>
      <div
        role="tablist"
        aria-label="Bookings view"
        className="inline-flex w-fit rounded-full bg-[var(--va-surface-sunk)] p-1"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === view;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={cn(
                "va-focus inline-flex h-10 items-center gap-2 rounded-full px-5 text-[14px] font-medium transition-colors duration-150",
                isActive
                  ? "bg-[var(--va-surface)] text-[var(--va-primary-ink)] va-shadow-soft"
                  : "text-[var(--va-muted)] hover:text-[var(--va-ink)]",
              )}
            >
              <Icon aria-hidden className="size-4" />
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// List screen
// ---------------------------------------------------------------------------

type KindFilter = "All" | BookingKind;

const KIND_FILTERS: KindFilter[] = ["All", "Tutoring", "Evaluation"];

function LocationLine({ booking }: { booking: Booking }): ReactNode {
  const isOffice = booking.location === "In office";
  const Icon = isOffice ? Building2 : MapPin;
  return (
    <span className="flex min-w-0 items-center gap-2 text-[14px] text-[var(--va-ink-soft)]">
      <Icon aria-hidden className="size-4 shrink-0 text-[var(--va-muted)]" />
      <span className="truncate">{booking.location}</span>
    </span>
  );
}

function BookingRow({ booking }: { booking: Booking }): ReactNode {
  const isCancelled = booking.status === "Cancelled";
  const start = formatTime(new Date(booking.start));
  return (
    <article
      className={cn(
        CARD,
        "group px-4 py-4 transition-colors duration-150 hover:border-[var(--va-tint-strong)] sm:px-5 lg:py-3",
      )}
    >
      {/* Phone and tablet: stacked card */}
      <div className="flex flex-col gap-3 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-[15px] font-semibold tabular-nums">
            <Clock aria-hidden className="size-4 text-[var(--va-muted)]" />
            {start}
            <span className="font-normal text-[var(--va-muted)]">
              · {booking.durationMin} min
            </span>
          </span>
          <StatusBadge status={booking.status} />
        </div>
        <div>
          <p
            className={cn(
              "va-display text-[17px] leading-6 font-bold",
              isCancelled && "line-through decoration-[var(--va-muted)]",
            )}
          >
            {booking.child}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <KindBadge kind={booking.kind} />
            <span className="text-[14px] text-[var(--va-muted)]">
              {booking.subject} · {booking.level}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-[var(--va-border)] pt-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-center gap-2 text-[14px]">
            <Avatar name={booking.tutor} size="sm" />
            {booking.tutor}
          </span>
          <LocationLine booking={booking} />
        </div>
      </div>

      {/* Desktop: card row on a shared column grid */}
      <div className="hidden min-h-12 grid-cols-[88px_minmax(0,1.3fr)_124px_minmax(0,1fr)_minmax(0,1.3fr)_124px_44px] items-center gap-4 lg:grid">
        <div className="tabular-nums">
          <p className="text-[15px] font-semibold">{start}</p>
          <p className="text-[13px] text-[var(--va-muted)]">
            {booking.durationMin} min
          </p>
        </div>
        <div className="min-w-0">
          <p
            className={cn(
              "va-display truncate text-[16px] leading-6 font-bold",
              isCancelled && "line-through decoration-[var(--va-muted)]",
            )}
          >
            {booking.child}
          </p>
          <p className="truncate text-[13px] text-[var(--va-muted)]">
            {booking.subject} · {booking.level}
          </p>
        </div>
        <span>
          <KindBadge kind={booking.kind} />
        </span>
        <span className="flex min-w-0 items-center gap-2.5 text-[14px]">
          <Avatar name={booking.tutor} size="sm" />
          <span className="truncate">{booking.tutor}</span>
        </span>
        <LocationLine booking={booking} />
        <span>
          <StatusBadge status={booking.status} />
        </span>
        <button
          type="button"
          aria-label={`More actions for ${booking.child}`}
          className={ICON_BUTTON}
        >
          <Ellipsis aria-hidden className="size-5" />
        </button>
      </div>
    </article>
  );
}

const TODO_STYLE: Record<
  TodoItem["kind"],
  { classes: string; icon: LucideIcon }
> = {
  "time-off": {
    classes: "bg-[var(--va-yellow-tint)] text-[var(--va-yellow-ink)]",
    icon: Plane,
  },
  chat: {
    classes: "bg-[var(--va-tint-strong)] text-[var(--va-primary-ink)]",
    icon: MessageCircle,
  },
  evaluation: {
    classes: "bg-[var(--va-pink-tint)] text-[var(--va-pink-ink)]",
    icon: Sparkles,
  },
  booking: {
    classes: "bg-[var(--va-green-tint)] text-[var(--va-green-ink)]",
    icon: CalendarClock,
  },
};

function TodoCard(): ReactNode {
  return (
    <section aria-labelledby="va-todo" className={cn(CARD, "p-5")}>
      <div className="flex items-center justify-between">
        <h2 id="va-todo" className="va-display text-[18px] font-bold">
          To do
        </h2>
        <Pill className="bg-[var(--va-pink-tint)] text-[var(--va-pink-ink)]">
          {todo.length} waiting
        </Pill>
      </div>
      <ul className="mt-4 flex flex-col gap-1">
        {todo.map((item) => {
          const style = TODO_STYLE[item.kind];
          const Icon = style.icon;
          return (
            <li key={item.id}>
              <a
                href="#"
                className="va-focus -mx-2 flex items-start gap-3 rounded-[16px] p-2 transition-colors duration-150 hover:bg-[var(--va-tint)]"
              >
                <span
                  className={cn(
                    "inline-flex size-10 shrink-0 items-center justify-center rounded-[14px]",
                    style.classes,
                  )}
                >
                  <Icon aria-hidden className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-5 font-semibold">
                    {item.title}
                  </span>
                  <span className="block text-[13px] leading-5 text-[var(--va-muted)]">
                    {item.detail}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WeekMixCard(): ReactNode {
  const live = bookings.filter((booking) => booking.status !== "Cancelled");
  const evaluations = live.filter((booking) => booking.kind === "Evaluation").length;
  const tutoring = live.length - evaluations;
  return (
    <section aria-labelledby="va-mix" className={cn(CARD, "p-5")}>
      <h2 id="va-mix" className="va-display text-[18px] font-bold">
        This week
      </h2>
      <div
        aria-hidden
        className="mt-4 flex h-3 overflow-hidden rounded-full bg-[var(--va-surface-sunk)]"
      >
        <span
          className="bg-[var(--va-hero)]"
          style={{ width: `${(tutoring / live.length) * 100}%` }}
        />
        <span
          className="bg-[var(--va-pink)]"
          style={{ width: `${(evaluations / live.length) * 100}%` }}
        />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {[
          { label: "Tutoring", value: tutoring, dot: KIND_STYLE.Tutoring.dot },
          {
            label: "Evaluation",
            value: evaluations,
            dot: KIND_STYLE.Evaluation.dot,
          },
        ].map((item) => (
          <div key={item.label} className="rounded-[16px] bg-[var(--va-tint)] p-3">
            <dt className="flex items-center gap-2 text-[13px] text-[var(--va-muted)]">
              <span aria-hidden className={cn("size-2 rounded-full", item.dot)} />
              {item.label}
            </dt>
            <dd className="va-display mt-1 text-[28px] leading-8 font-light tabular-nums">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function BookingsList({ theme }: ScreenProps): ReactNode {
  const [kindFilter, setKindFilter] = useState<KindFilter>("All");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = bookings.filter(
    (booking) =>
      (kindFilter === "All" || booking.kind === kindFilter) &&
      (needle === "" ||
        booking.child.toLowerCase().includes(needle) ||
        booking.tutor.toLowerCase().includes(needle)),
  );
  const groups = groupByDay(visible);

  return (
    <OfficeShell>
      <BookingsHeader view="list" />
      <div className="grid gap-8 min-[1600px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="flex flex-col gap-3 pb-6 md:flex-row md:items-center">
            <label className="relative block md:w-[320px]">
              <span className="sr-only">Search bookings</span>
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-[var(--va-muted)]"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search a child or tutor"
                className="va-focus h-11 w-full rounded-full border border-[var(--va-border)] bg-[var(--va-surface)] pr-4 pl-11 text-[14px] text-[var(--va-ink)] placeholder:text-[var(--va-muted)]"
              />
            </label>
            <div className="va-no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
              {KIND_FILTERS.map((kind) => {
                const isActive = kind === kindFilter;
                return (
                  <button
                    key={kind}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setKindFilter(kind)}
                    className={cn(
                      BUTTON_BASE,
                      "px-4",
                      isActive
                        ? "bg-[var(--va-tint-strong)] font-semibold text-[var(--va-primary-ink)]"
                        : "border border-[var(--va-border)] bg-[var(--va-surface)] text-[var(--va-ink-soft)] hover:bg-[var(--va-tint)]",
                    )}
                  >
                    {isActive && <Check aria-hidden className="size-4" />}
                    {kind === "All" ? "All kinds" : kind}
                  </button>
                );
              })}
              <button type="button" className={cn(BUTTON_OUTLINE, "px-4")}>
                <SlidersHorizontal aria-hidden className="size-4" />
                More filters
              </button>
            </div>
          </div>

          <div className="hidden grid-cols-[88px_minmax(0,1.3fr)_124px_minmax(0,1fr)_minmax(0,1.3fr)_124px_44px] gap-4 px-5 pb-2 lg:grid">
            {["Time", "Child", "Kind", "Tutor", "Location", "Status"].map(
              (label) => (
                <span key={label} className={EYEBROW}>
                  {label}
                </span>
              ),
            )}
          </div>

          {groups.length === 0 ? (
            <div className={cn(CARD, "p-10 text-center")}>
              <p className="va-display text-[20px] font-light">
                No bookings match.
              </p>
              <p className="mt-1 text-[14px] text-[var(--va-muted)]">
                Try another name, or show all kinds.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-8">
              {groups.map((group) => (
                <section key={group.dayKey} aria-label={group.dayKey}>
                  <h2 className="flex items-baseline gap-3 px-1 pb-3">
                    <span className="va-display text-[18px] font-bold">
                      {getRelativeDayLabel(group.dayKey)}
                    </span>
                    <span className="text-[14px] text-[var(--va-muted)]">
                      {formatDay(group.dayKey, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      · {group.items.length}{" "}
                      {group.items.length === 1 ? "booking" : "bookings"}
                    </span>
                  </h2>
                  <div className="flex flex-col gap-3">
                    {group.items.map((booking) => (
                      <BookingRow key={booking.id} booking={booking} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
        <div className="hidden flex-col gap-6 min-[1600px]:flex">
          <TodoCard />
          <WeekMixCard />
        </div>
      </div>
      <SpecStrip theme={theme} />
    </OfficeShell>
  );
}

// ---------------------------------------------------------------------------
// Calendar screen
// ---------------------------------------------------------------------------

const HOUR_LABELS = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR },
  (_, index) => DAY_START_HOUR + index,
);

function formatHour(hour: number): string {
  const suffix = hour < NOON ? "AM" : "PM";
  const display = hour > NOON ? hour - NOON : hour;
  return `${display} ${suffix}`;
}

function TimeGutter({ hourPx }: { hourPx: number }): ReactNode {
  return (
    <div aria-hidden className="relative w-14 shrink-0">
      {HOUR_LABELS.map((hour, index) => (
        <span
          key={hour}
          className="absolute right-3 -translate-y-1/2 text-[12px] whitespace-nowrap text-[var(--va-muted)] tabular-nums"
          style={{ top: index * hourPx }}
        >
          {formatHour(hour)}
        </span>
      ))}
    </div>
  );
}

type EventBlockProps = {
  placed: PlacedBooking;
  hourPx: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
};

function EventBlock({
  placed,
  hourPx,
  isSelected,
  onSelect,
}: EventBlockProps): ReactNode {
  const { booking, lane, laneCount } = placed;
  const top = (getMinutesIntoDay(booking.start) / MINUTES_PER_HOUR) * hourPx;
  const height = (booking.durationMin / MINUTES_PER_HOUR) * hourPx;
  const isCancelled = booking.status === "Cancelled";
  const isPending = booking.status === "Pending";
  const style = KIND_STYLE[booking.kind];
  const Icon = style.icon;
  const isRoomy = height >= hourPx * 1.4;
  return (
    <button
      type="button"
      onClick={() => onSelect(booking.id)}
      aria-pressed={isSelected}
      aria-label={`${booking.kind}, ${booking.child}, ${formatTimeRange(booking)}, ${booking.tutor}, ${booking.status}`}
      className={cn(
        "va-focus absolute overflow-hidden rounded-[12px] px-1.5 py-1.5 text-left transition-shadow duration-150",
        isCancelled
          ? "va-hatched bg-[var(--va-neutral-tint)] text-[var(--va-neutral)]"
          : style.classes,
        isPending && "border border-dashed border-[var(--va-warning)]",
        isSelected
          ? "z-10 ring-2 ring-[var(--va-primary)] ring-offset-2 ring-offset-[var(--va-surface)] va-shadow-raised"
          : "hover:brightness-[0.97]",
      )}
      style={{
        top: top + 2,
        height: height - 4,
        left: `calc(${(lane / laneCount) * 100}% + 4px)`,
        width: `calc(${100 / laneCount}% - 8px)`,
      }}
    >
      <span className="flex items-center gap-0.5 text-[12px] font-medium tabular-nums">
        <Icon aria-hidden className="size-3 shrink-0" />
        <span className="truncate">{formatTime(new Date(booking.start))}</span>
      </span>
      <span
        className={cn(
          "block truncate text-[13px] leading-[18px] font-semibold",
          isCancelled && "line-through",
        )}
      >
        {booking.child}
      </span>
      {isRoomy && (
        <span className="block truncate text-[12px]">
          {isPending ? "Pending" : `${booking.subject} · ${booking.tutor}`}
        </span>
      )}
    </button>
  );
}

type DayColumnProps = {
  dayKey: string;
  hourPx: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

function DayColumn({
  dayKey,
  hourPx,
  selectedId,
  onSelect,
}: DayColumnProps): ReactNode {
  const items = bookings.filter((booking) => getDayKey(booking.start) === dayKey);
  const isToday = dayKey === today;
  const nowTop = (getMinutesIntoDay(NOW) / MINUTES_PER_HOUR) * hourPx;
  return (
    <div
      className={cn(
        "va-hour-lines relative min-w-0 flex-1 border-l border-[var(--va-border)]",
        isToday && "bg-[var(--va-today-col)]",
      )}
      style={{
        height: HOUR_LABELS.length * hourPx,
        backgroundSize: `100% ${hourPx}px`,
      }}
    >
      {layoutDay(items).map((placed) => (
        <EventBlock
          key={placed.booking.id}
          placed={placed}
          hourPx={hourPx}
          isSelected={placed.booking.id === selectedId}
          onSelect={onSelect}
        />
      ))}
      {isToday && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
          style={{ top: nowTop }}
        >
          <span className="-ml-1.5 size-3 rounded-full bg-[var(--va-primary)]" />
          <span className="h-0.5 flex-1 bg-[var(--va-primary)]" />
        </div>
      )}
    </div>
  );
}

type DetailRowProps = { icon: LucideIcon; label: string; children: ReactNode };

function DetailRow({ icon: Icon, label, children }: DetailRowProps): ReactNode {
  return (
    <div className="flex gap-3">
      <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[var(--va-tint)] text-[var(--va-primary-ink)]">
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-[var(--va-muted)]">{label}</p>
        <div className="mt-0.5 text-[14px] leading-5">{children}</div>
      </div>
    </div>
  );
}

function ChildNotesCard({ notes }: { notes: string }): ReactNode {
  return (
    <div className="rounded-[18px] bg-[var(--va-yellow-tint)] p-4 text-[var(--va-yellow-ink)]">
      <p className="flex items-center gap-2 text-[13px] font-semibold">
        <NotebookPen aria-hidden className="size-4" />
        Child notes
      </p>
      <p className="mt-1.5 text-[14px] leading-6">{notes}</p>
    </div>
  );
}

type BookingDetailProps = { booking: Booking; onClose: () => void };

function BookingDetail({ booking, onClose }: BookingDetailProps): ReactNode {
  const isOffice = booking.location === "In office";
  return (
    <>
      <button
        type="button"
        aria-label="Close booking details"
        onClick={onClose}
        className="fixed inset-0 z-30 bg-[var(--va-scrim)] xl:hidden"
      />
      <aside
        aria-label={`Booking details: ${booking.child}`}
        className="va-rise va-shadow-raised fixed inset-x-0 bottom-0 z-40 flex max-h-[64dvh] flex-col overflow-y-auto rounded-t-[28px] border border-[var(--va-card-border)] bg-[var(--va-surface)] md:inset-x-auto md:top-4 md:right-4 md:bottom-4 md:max-h-none md:w-[380px] md:rounded-[28px] xl:sticky xl:inset-auto xl:top-6 xl:z-auto xl:max-h-[calc(100dvh-48px)] xl:w-auto xl:self-start"
      >
        <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-[var(--va-border)] md:hidden" />
        <div className="flex items-start justify-between gap-3 px-6 pt-4 md:pt-6">
          <div className="flex flex-wrap gap-2">
            <KindBadge kind={booking.kind} />
            <StatusBadge status={booking.status} />
          </div>
          <button
            type="button"
            aria-label="Close booking details"
            onClick={onClose}
            className={cn(ICON_BUTTON, "-mt-2 -mr-2")}
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <div className="px-6 pt-3">
          <h2 className="va-display text-[28px] leading-9 font-light">
            {booking.child}
          </h2>
          <p className="text-[14px] text-[var(--va-muted)]">
            Subject level: {booking.subject} · {booking.level}
          </p>
        </div>
        <div className="flex flex-col gap-4 px-6 pt-6">
          <DetailRow icon={CalendarDays} label="When">
            <p className="font-semibold">
              {formatDay(getDayKey(booking.start), {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
            <p className="text-[var(--va-ink-soft)] tabular-nums">
              {formatTimeRange(booking)} · {booking.durationMin} min
            </p>
          </DetailRow>
          <DetailRow icon={Users} label="Staff">
            <span className="flex items-center gap-2 font-semibold">
              <Avatar name={booking.tutor} size="sm" />
              {booking.tutor}
            </span>
          </DetailRow>
          <DetailRow icon={isOffice ? Building2 : MapPin} label="Location">
            <p className="font-semibold">{booking.location}</p>
            {booking.directions && (
              <p className="text-[var(--va-ink-soft)]">{booking.directions}</p>
            )}
          </DetailRow>
          <DetailRow icon={MessageCircle} label="Guardian">
            <p className="font-semibold">{booking.guardian}</p>
            <a
              href="#"
              className="va-focus rounded-full font-medium text-[var(--va-link)] underline-offset-4 hover:underline"
            >
              Open chat
            </a>
          </DetailRow>
          {booking.childNotes && <ChildNotesCard notes={booking.childNotes} />}
        </div>
        <div className="mt-auto flex flex-col gap-2 px-6 pt-8 pb-6 sm:flex-row">
          <button type="button" className={cn(BUTTON_PRIMARY, "flex-1")}>
            Change booking
          </button>
          <button type="button" className={cn(BUTTON_DANGER, "flex-1")}>
            Cancel booking
          </button>
        </div>
      </aside>
    </>
  );
}

function CalendarToolbar(): ReactNode {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-5">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Previous week" className={ICON_BUTTON}>
          <ChevronLeft aria-hidden className="size-5" />
        </button>
        <p className="va-display px-1 text-[18px] font-bold tabular-nums">
          Oct 12 – 18, 2026
        </p>
        <button type="button" aria-label="Next week" className={ICON_BUTTON}>
          <ChevronRight aria-hidden className="size-5" />
        </button>
        <button type="button" className={cn(BUTTON_SOFT, "ml-2 h-10 px-4")}>
          Today
        </button>
      </div>
      <div className="flex items-center gap-2">
        {(["Tutoring", "Evaluation"] as const).map((kind) => (
          <span
            key={kind}
            className="inline-flex items-center gap-2 text-[13px] text-[var(--va-ink-soft)]"
          >
            <span
              aria-hidden
              className={cn("size-2.5 rounded-full", KIND_STYLE[kind].dot)}
            />
            {kind}
          </span>
        ))}
        <button type="button" className={cn(BUTTON_OUTLINE, "ml-2 h-10 px-4")}>
          All tutors
          <ChevronDown aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}

function BookingsCalendar({ theme }: ScreenProps): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(
    DEFAULT_SELECTED_ID,
  );
  const [phoneDay, setPhoneDay] = useState(today);
  const days = getWeekDays();
  const selected = bookings.find((booking) => booking.id === selectedId) ?? null;
  const phoneDayCount = bookings.filter(
    (booking) => getDayKey(booking.start) === phoneDay,
  ).length;

  return (
    <OfficeShell>
      <BookingsHeader view="calendar" />
      <div
        className={cn(
          "xl:grid xl:gap-6",
          selected && "xl:grid-cols-[minmax(0,1fr)_360px]",
        )}
      >
        <div className="min-w-0">
          <CalendarToolbar />

          {/* Week view, tablet and up */}
          <div className={cn(CARD, "hidden overflow-hidden rounded-[24px] md:block")}>
            <div className="flex border-b border-[var(--va-border)] py-3">
              <div className="w-14 shrink-0" />
              {days.map((dayKey) => {
                const isToday = dayKey === today;
                return (
                  <div
                    key={dayKey}
                    className="flex min-w-0 flex-1 flex-col items-center gap-1"
                  >
                    <span className={EYEBROW}>
                      {formatDay(dayKey, { weekday: "short" })}
                    </span>
                    <span
                      className={cn(
                        "inline-flex size-9 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums",
                        isToday
                          ? "bg-[var(--va-primary)] text-[var(--va-on-primary)]"
                          : "text-[var(--va-ink)]",
                      )}
                    >
                      {formatDay(dayKey, { day: "numeric" })}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex py-3 pr-2">
              <TimeGutter hourPx={HOUR_PX_WEEK} />
              {days.map((dayKey) => (
                <DayColumn
                  key={dayKey}
                  dayKey={dayKey}
                  hourPx={HOUR_PX_WEEK}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          </div>

          {/* Day view, phones */}
          <div className="md:hidden">
            <div className="va-no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-4">
              {days.map((dayKey) => {
                const isActive = dayKey === phoneDay;
                const hasBookings = bookings.some(
                  (booking) => getDayKey(booking.start) === dayKey,
                );
                return (
                  <button
                    key={dayKey}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setPhoneDay(dayKey)}
                    className={cn(
                      "va-focus flex h-16 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-full transition-colors duration-150",
                      isActive
                        ? "bg-[var(--va-primary)] text-[var(--va-on-primary)] va-shadow-soft"
                        : "bg-[var(--va-surface)] text-[var(--va-ink)]",
                    )}
                  >
                    <span className="text-[12px] font-medium">
                      {formatDay(dayKey, { weekday: "narrow" })}
                    </span>
                    <span className="text-[16px] font-semibold tabular-nums">
                      {formatDay(dayKey, { day: "numeric" })}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "size-1 rounded-full",
                        hasBookings ? "bg-current" : "bg-transparent",
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <p className="px-1 pb-3 text-[14px] text-[var(--va-muted)]">
              <span className="va-display text-[18px] font-bold text-[var(--va-ink)]">
                {getRelativeDayLabel(phoneDay)}
              </span>{" "}
              · {phoneDayCount} {phoneDayCount === 1 ? "booking" : "bookings"}
            </p>
            <div className={cn(CARD, "flex rounded-[24px] py-4 pr-2")}>
              <TimeGutter hourPx={HOUR_PX_DAY} />
              <DayColumn
                dayKey={phoneDay}
                hourPx={HOUR_PX_DAY}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            </div>
          </div>
        </div>
        {selected && (
          <BookingDetail booking={selected} onClose={() => setSelectedId(null)} />
        )}
      </div>
      <SpecStrip theme={theme} />
    </OfficeShell>
  );
}

// ---------------------------------------------------------------------------
// Tutor screen: My sessions on a phone
// ---------------------------------------------------------------------------

type SessionCardProps = {
  session: Booking;
  isExpanded: boolean;
  isNext: boolean;
  onToggle: (id: string) => void;
};

function SessionCard({
  session,
  isExpanded,
  isNext,
  onToggle,
}: SessionCardProps): ReactNode {
  const start = new Date(session.start);
  const [clock, meridiem] = formatTime(start).split(" ");
  const isOffice = session.location === "In office";
  const guardianFirst = session.guardian.split(" ")[0];
  const panelId = `va-session-${session.id}`;
  return (
    <article
      className={cn(
        CARD,
        "overflow-hidden",
        isNext && "border-[var(--va-hero)]",
      )}
    >
      {isNext && (
        <div className="flex items-center gap-2 bg-[var(--va-tint)] px-4 py-2 text-[12px] font-semibold tracking-[0.14em] text-[var(--va-primary-ink)] uppercase">
          <Sparkles aria-hidden className="size-3.5" />
          Next up
        </div>
      )}
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        onClick={() => onToggle(session.id)}
        className="va-focus flex w-full items-start gap-4 p-4 text-left"
      >
        <span className="flex w-14 shrink-0 flex-col items-center rounded-[16px] bg-[var(--va-tint)] py-2 text-[var(--va-primary-ink)] tabular-nums">
          <span className="text-[17px] leading-6 font-semibold">{clock}</span>
          <span className="text-[12px] font-medium">{meridiem}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <KindBadge kind={session.kind} />
            <ChevronDown
              aria-hidden
              className={cn(
                "size-5 shrink-0 text-[var(--va-muted)] transition-transform duration-200",
                isExpanded && "rotate-180",
              )}
            />
          </span>
          <span className="va-display mt-2 block text-[18px] leading-6 font-bold">
            {session.child}
          </span>
          <span className="mt-0.5 block text-[14px] text-[var(--va-muted)] tabular-nums">
            {session.subject} · {session.level} · {session.durationMin} min
          </span>
          {!isExpanded && (
            <span className="mt-2 block">
              <LocationLine booking={session} />
            </span>
          )}
        </span>
      </button>
      {isExpanded && (
        <div
          id={panelId}
          className="va-rise flex flex-col gap-4 border-t border-[var(--va-border)] px-4 pt-4 pb-5"
        >
          <DetailRow icon={BookOpen} label="Subject level">
            <p className="font-semibold">
              {session.subject} · {session.level}
            </p>
          </DetailRow>
          {session.childNotes && <ChildNotesCard notes={session.childNotes} />}
          <DetailRow icon={isOffice ? Building2 : MapPin} label="Location">
            <p className="font-semibold">
              {isOffice ? "In office" : session.location}
            </p>
            {session.directions && (
              <p className="text-[var(--va-ink-soft)]">{session.directions}</p>
            )}
          </DetailRow>
          {!isOffice && (
            <button type="button" className={cn(BUTTON_OUTLINE, "w-full")}>
              <Navigation aria-hidden className="size-4" />
              Get directions
            </button>
          )}
          <div className="rounded-[18px] bg-[var(--va-pink-tint)] p-4">
            <p className="text-[13px] text-[var(--va-pink-ink)]">Guardian</p>
            <p className="text-[15px] font-semibold text-[var(--va-pink-ink)]">
              {session.guardian}
            </p>
            <p className="mt-1 text-[14px] leading-5 text-[var(--va-pink-ink)]">
              Need to reach {guardianFirst}? The office passes messages on for
              you.
            </p>
            <button type="button" className={cn(BUTTON_PRIMARY, "mt-3 w-full")}>
              <MessageCircle aria-hidden className="size-4" />
              Message the office
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function TutorSessions({ theme }: ScreenProps): ReactNode {
  const todaySessions = tutorSessions.filter(
    (session) => getDayKey(session.start) === today && session.start >= NOW,
  );
  const upcomingGroups = groupByDay(
    tutorSessions.filter((session) => getDayKey(session.start) > today),
  );
  const nextSession = todaySessions[0] ?? null;
  const [expandedId, setExpandedId] = useState<string | null>(
    nextSession?.id ?? null,
  );
  const tutorFirst = currentTutor.split(" ")[0];

  function handleToggle(id: string): void {
    setExpandedId((current) => (current === id ? null : id));
  }

  function renderCard(session: Booking): ReactNode {
    return (
      <SessionCard
        key={session.id}
        session={session}
        isExpanded={session.id === expandedId}
        isNext={session.id === nextSession?.id}
        onToggle={handleToggle}
      />
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col">
      <header className="flex items-center justify-between px-5 pt-5">
        <Wordmark isCompact />
        <Avatar name={currentTutor} />
      </header>
      <main className="flex-1 px-5 pb-6">
        <div className="pt-8 pb-6">
          <EyebrowPill>
            {formatDay(today, { weekday: "long", month: "long", day: "numeric" })}
          </EyebrowPill>
          <h1 className="va-display mt-3 text-[34px] leading-[42px] font-light tracking-[-0.01em]">
            {getGreeting(NOW)}, {tutorFirst}
          </h1>
          <p className="mt-1 text-[15px] leading-6 text-[var(--va-muted)]">
            You have {todaySessions.length} sessions today.
            {nextSession &&
              ` The first starts at ${formatTime(new Date(nextSession.start))}.`}
          </p>
        </div>
        <div
          role="tablist"
          aria-label="My sessions"
          className="mb-6 grid grid-cols-2 rounded-full bg-[var(--va-surface-sunk)] p-1"
        >
          {["Upcoming", "Past"].map((label) => {
            const isActive = label === "Upcoming";
            return (
              <button
                key={label}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={cn(
                  "va-focus h-10 rounded-full text-[14px] font-medium",
                  isActive
                    ? "bg-[var(--va-surface)] text-[var(--va-primary-ink)] va-shadow-soft"
                    : "text-[var(--va-muted)]",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <section aria-labelledby="va-today">
          <h2 id="va-today" className="va-display pb-3 text-[20px] font-bold">
            Today
          </h2>
          <div className="flex flex-col gap-3">
            {todaySessions.map(renderCard)}
          </div>
        </section>
        {upcomingGroups.map((group) => (
          <section key={group.dayKey} aria-label={group.dayKey} className="pt-8">
            <h2 className="flex items-baseline gap-2 pb-3">
              <span className="va-display text-[20px] font-bold">
                {getRelativeDayLabel(group.dayKey)}
              </span>
              <span className="text-[14px] text-[var(--va-muted)]">
                {formatDay(group.dayKey, { month: "short", day: "numeric" })}
              </span>
            </h2>
            <div className="flex flex-col gap-3">{group.items.map(renderCard)}</div>
          </section>
        ))}
        <SpecStrip theme={theme} />
      </main>
      <BottomTabBar items={TUTOR_NAV} active="My sessions" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spec strip
// ---------------------------------------------------------------------------

const SWATCH_GROUPS: { title: string; tokens: TokenName[] }[] = [
  {
    title: "Brand pastels",
    tokens: [
      "hero",
      "tint",
      "tint-strong",
      "pink",
      "pink-tint",
      "yellow",
      "yellow-tint",
      "green",
      "green-tint",
    ],
  },
  {
    title: "Primary and accents (text-safe)",
    tokens: ["primary", "primary-hover", "link", "primary-ink", "pink-ink", "yellow-ink", "green-ink"],
  },
  {
    title: "Neutrals",
    tokens: ["ink", "ink-soft", "muted", "border", "surface-sunk", "surface", "canvas"],
  },
];

const STATUS_SAMPLES: { label: string; tone: Tone }[] = [
  { label: "Success", tone: "success" },
  { label: "Warning", tone: "warning" },
  { label: "Danger", tone: "danger" },
  { label: "Info", tone: "info" },
  { label: "Neutral", tone: "neutral" },
];

const TYPE_SCALE = [
  { name: "Display", spec: "Lato 300 · 44/52", className: "va-display text-[44px] leading-[52px] font-light" },
  { name: "Title", spec: "Lato 300 · 34/42", className: "va-display text-[34px] leading-[42px] font-light" },
  { name: "Heading", spec: "Lato 700 · 20/28", className: "va-display text-[20px] leading-7 font-bold" },
  { name: "Card title", spec: "Lato 700 · 16–18/24", className: "va-display text-[17px] leading-6 font-bold" },
  { name: "Body", spec: "Inter 400 · 15/24", className: "text-[15px] leading-6" },
  { name: "UI", spec: "Inter 500 · 14/20", className: "text-[14px] leading-5 font-medium" },
  { name: "Caption", spec: "Inter 400–500 · 13/18, tabular", className: "text-[13px] leading-[18px] tabular-nums" },
  { name: "Eyebrow", spec: "Inter 600 · 12/16, +0.14em caps", className: EYEBROW },
];

const RADII = [
  { name: "Pill", value: "999px", note: "buttons, badges, inputs, nav", px: 999 },
  { name: "Panel", value: "24–28px", note: "sidebar, sheets, calendar", px: 26 },
  { name: "Card", value: "20px", note: "rows, cards", px: 20 },
  { name: "Chip", value: "12–16px", note: "events, icon chips", px: 14 },
];

const DENSITY = [
  ["Control height", "44px (40 inside segmented)"],
  ["List row", "≥ 72px card, 12px apart"],
  ["Card padding", "20px"],
  ["Section gap", "32px"],
  ["Page gutter", "16px phone · 40px desktop"],
  ["Calendar hour", "56px week · 64px day"],
];

function SpecStrip({ theme }: ScreenProps): ReactNode {
  return (
    <details className={cn(CARD, "group mt-10")}>
      <summary className="va-focus flex cursor-pointer items-center justify-between gap-3 rounded-[20px] px-5 py-4">
        <span className="flex items-center gap-3">
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-[var(--va-tint)] text-[var(--va-primary-ink)]">
            <Palette aria-hidden className="size-[18px]" />
          </span>
          <span>
            <span className="block text-[14px] font-semibold">Design tokens</span>
            <span className="block text-[13px] text-[var(--va-muted)]">
              Variant A · {variantName}
            </span>
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className="size-5 text-[var(--va-muted)] transition-transform duration-200 group-open:rotate-180"
        />
      </summary>
      <SpecContent theme={theme} />
    </details>
  );
}

function SpecContent({ theme }: ScreenProps): ReactNode {
  return (
    <div className="flex flex-col gap-8 border-t border-[var(--va-border)] px-5 pt-5 pb-6">
      <div>
        <h3 className={EYEBROW}>Primary ramp · hue 195°</h3>
        <div className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-10">
          {PRIMARY_RAMP.map(([step, hex]) => (
            <div key={step}>
              <span
                className="block h-10 rounded-[12px] border border-[var(--va-card-border)]"
                style={{ background: hex }}
              />
              <span className="mt-1 block text-[12px] font-semibold tabular-nums">
                {step}
              </span>
              <span className="block text-[12px] text-[var(--va-muted)] tabular-nums">
                {hex}
              </span>
            </div>
          ))}
        </div>
      </div>
      {SWATCH_GROUPS.map((group) => (
        <div key={group.title}>
          <h3 className={EYEBROW}>{group.title}</h3>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {group.tokens.map((token) => (
              <Swatch key={token} token={token} theme={theme} />
            ))}
          </div>
        </div>
      ))}
      <div>
        <h3 className={EYEBROW}>Status (fg on tint)</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {STATUS_SAMPLES.map((sample) => (
            <Pill key={sample.tone} className={TONE_CLASSES[sample.tone]}>
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {sample.label}
              <span className="font-normal opacity-90">
                {TOKENS[theme][sample.tone]}
              </span>
            </Pill>
          ))}
        </div>
      </div>
      <div>
        <h3 className={EYEBROW}>Type scale</h3>
        <ul className="mt-3 flex flex-col gap-3">
          {TYPE_SCALE.map((entry) => (
            <li
              key={entry.name}
              className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-6"
            >
              <span className="w-56 shrink-0 text-[13px] text-[var(--va-muted)] tabular-nums">
                {entry.name} · {entry.spec}
              </span>
              <span className={cn(entry.className, "min-w-0 truncate")}>
                Helping every child
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid gap-8 md:grid-cols-3">
        <div>
          <h3 className={EYEBROW}>Radius</h3>
          <ul className="mt-3 flex flex-col gap-3">
            {RADII.map((radius) => (
              <li key={radius.name} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="h-9 w-14 shrink-0 border-2 border-[var(--va-primary)] bg-[var(--va-tint)]"
                  style={{ borderRadius: Math.min(radius.px, 18) }}
                />
                <span className="text-[13px]">
                  <span className="font-semibold">
                    {radius.name} {radius.value}
                  </span>
                  <span className="block text-[var(--va-muted)]">{radius.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className={EYEBROW}>Elevation</h3>
          <ul className="mt-3 flex flex-col gap-4">
            <li className="rounded-[16px] border border-[var(--va-border)] bg-[var(--va-surface)] p-3 text-[13px]">
              <span className="font-semibold">Flat</span>
              <span className="block text-[var(--va-muted)]">
                1px border, inputs and chips
              </span>
            </li>
            <li className="va-shadow-soft rounded-[16px] bg-[var(--va-surface)] p-3 text-[13px]">
              <span className="font-semibold">Soft</span>
              <span className="block text-[var(--va-muted)]">
                0 10 30 −12, blue-tinted · cards, rows
              </span>
            </li>
            <li className="va-shadow-raised rounded-[16px] bg-[var(--va-surface)] p-3 text-[13px]">
              <span className="font-semibold">Raised</span>
              <span className="block text-[var(--va-muted)]">
                0 28 56 −20 · sheets, tab bar, selection
              </span>
            </li>
          </ul>
        </div>
        <div>
          <h3 className={EYEBROW}>Density · comfortable</h3>
          <dl className="mt-3 flex flex-col gap-2 text-[13px]">
            {DENSITY.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-[var(--va-muted)]">{label}</dt>
                <dd className="text-right font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}

type SwatchProps = { token: TokenName; theme: Theme };

function Swatch({ token, theme }: SwatchProps): ReactNode {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="size-10 shrink-0 rounded-full border border-[var(--va-card-border)]"
        style={{ background: `var(--va-${token})` }}
      />
      <span className="min-w-0 text-[12px]">
        <span className="block truncate font-semibold">{token}</span>
        <span className="block text-[var(--va-muted)] tabular-nums">
          {TOKENS[theme][token]}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export function VariantA({ theme, screen }: VariantProps): ReactNode {
  let content: ReactNode = <BookingsList theme={theme} />;
  if (screen === "calendar") {
    content = <BookingsCalendar theme={theme} />;
  } else if (screen === "tutor") {
    content = <TutorSessions theme={theme} />;
  }
  return (
    <div
      data-variant="a"
      data-theme={theme}
      style={getTokenStyle(theme)}
      className="min-h-dvh text-[15px] leading-6"
    >
      {content}
    </div>
  );
}
