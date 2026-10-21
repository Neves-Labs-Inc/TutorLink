// WhatsApp's 24-hour reply window, measured from the Guardian's last message.
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

export const REPLY_WINDOW_MS = 24 * MS_PER_HOUR;
// Under this, a closing window is urgent and turns warning-coloured.
export const REPLY_WINDOW_URGENT_MS = 3 * MS_PER_HOUR;

export type ReplyWindow = {
  isOpen: boolean;
  msLeft: number;
  closesAt: string | null;
};

export function getReplyWindow(
  lastClientMessageAt: string | null,
  nowMs: number,
): ReplyWindow {
  if (lastClientMessageAt === null) {
    return { isOpen: false, msLeft: 0, closesAt: null };
  }
  const closesAtMs = Date.parse(lastClientMessageAt) + REPLY_WINDOW_MS;
  const msLeft = closesAtMs - nowMs;
  return {
    isOpen: msLeft > 0,
    msLeft: Math.max(0, msLeft),
    closesAt: new Date(closesAtMs).toISOString(),
  };
}

// "5h" from an hour up (floored), else "40 min" (never below "1 min").
export function formatTimeLeft(ms: number): string {
  const hours = Math.floor(ms / MS_PER_HOUR);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.round(ms / MS_PER_MINUTE))} min`;
}
