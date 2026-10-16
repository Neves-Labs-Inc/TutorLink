// Time copy for Chats. Business time is fixed (Doral, FL), so every
// formatter pins the zone instead of trusting the viewer's machine.
import { NOW_ISO } from "@/pages/prototype/chats/mock/chats-mock";

const ZONE = "America/New_York";
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const WINDOW_MS = MS_PER_DAY;
// Under this, a closing window is urgent and turns warning-coloured.
export const WINDOW_URGENT_MS = 3 * MS_PER_HOUR;
const DAYS_SHOWN_AS_WEEKDAY = 6;

export function getNowMs(): number {
  return Date.parse(NOW_ISO);
}

function getDayKey(iso: string | number): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: ZONE });
}

export function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: ZONE,
  });
}

function getDaysAgo(iso: string): number {
  const today = Date.parse(`${getDayKey(getNowMs())}T12:00:00Z`);
  const day = Date.parse(`${getDayKey(iso)}T12:00:00Z`);
  return Math.round((today - day) / MS_PER_DAY);
}

// List timestamps: "8:31 AM", "Yesterday", "Sun", "4 Oct".
export function formatListTime(iso: string): string {
  const daysAgo = getDaysAgo(iso);
  let label = new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: ZONE,
  });
  if (daysAgo === 0) {
    label = formatClockTime(iso);
  } else if (daysAgo === 1) {
    label = "Yesterday";
  } else if (daysAgo <= DAYS_SHOWN_AS_WEEKDAY) {
    label = new Date(iso).toLocaleDateString("en-US", {
      weekday: "short",
      timeZone: ZONE,
    });
  }
  return label;
}

// Thread day separators: "Today", "Yesterday", "Sunday 11 October".
export function formatDayHeading(iso: string): string {
  const daysAgo = getDaysAgo(iso);
  let label = new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: ZONE,
  });
  if (daysAgo === 0) {
    label = "Today";
  } else if (daysAgo === 1) {
    label = "Yesterday";
  }
  return label;
}

export function isSameDay(a: string, b: string): boolean {
  return getDayKey(a) === getDayKey(b);
}

// "Sun 18 Oct, 5:00 PM"
export function formatDayAndTime(iso: string): string {
  const day = new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: ZONE,
  });
  return `${day}, ${formatClockTime(iso)}`;
}

// "Week of 19 Oct" from a Monday "YYYY-MM-DD".
export function formatWeekLabel(weekStart: string): string {
  const date = new Date(`${weekStart}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `Week of ${date}`;
}

export type WindowState = {
  isOpen: boolean;
  msLeft: number;
  closesAt: string | null;
};

// The 24-hour window runs from the Guardian's last message.
export function getWindowState(lastClientAt: string | null): WindowState {
  if (lastClientAt === null) {
    return { isOpen: false, msLeft: 0, closesAt: null };
  }
  const closesAtMs = Date.parse(lastClientAt) + WINDOW_MS;
  const msLeft = closesAtMs - getNowMs();
  return {
    isOpen: msLeft > 0,
    msLeft: Math.max(0, msLeft),
    closesAt: new Date(closesAtMs).toISOString(),
  };
}

// "5h", "40 min"
export function formatDuration(ms: number): string {
  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.max(1, Math.round((ms % MS_PER_HOUR) / MS_PER_MINUTE));
  return hours >= 1 ? `${hours}h` : `${minutes} min`;
}
