export type ToastTone = "neutral" | "success";

export type ToastEntry = {
  id: string;
  message: string;
  tone: ToastTone;
  durationMs: number;
  // false while the exit animation plays; the entry is removed once it ends.
  open: boolean;
};

export type ToastOptions = {
  tone?: ToastTone;
  durationMs?: number;
};

export type ToastAction =
  | ({ type: "add"; message: string } & ToastOptions)
  | { type: "close"; id: string }
  | { type: "dismiss"; id: string };

export const DEFAULT_TOAST_DURATION_MS = 5000;
// Enough to see a burst of results without burying the page; older ones close first.
export const MAX_VISIBLE_TOASTS = 3;

let nextId = 0;

function createToastId(): string {
  nextId += 1;
  return `toast-${nextId}`;
}

function closeOldestBeyondCap(toasts: ToastEntry[]): ToastEntry[] {
  const openCount = toasts.filter((toast) => toast.open).length;
  const overflow = openCount - MAX_VISIBLE_TOASTS;
  if (overflow <= 0) return toasts;

  const closingIds = new Set(
    toasts
      .filter((toast) => toast.open)
      .slice(0, overflow)
      .map((toast) => toast.id),
  );
  return toasts.map((toast) => (closingIds.has(toast.id) ? { ...toast, open: false } : toast));
}

export function nextToasts(toasts: ToastEntry[], action: ToastAction): ToastEntry[] {
  if (action.type === "dismiss") {
    return toasts.filter((toast) => toast.id !== action.id);
  }
  if (action.type === "close") {
    return toasts.map((toast) => (toast.id === action.id ? { ...toast, open: false } : toast));
  }

  const added: ToastEntry = {
    id: createToastId(),
    message: action.message,
    tone: action.tone ?? "neutral",
    durationMs: action.durationMs ?? DEFAULT_TOAST_DURATION_MS,
    open: true,
  };
  return closeOldestBeyondCap([...toasts, added]);
}
