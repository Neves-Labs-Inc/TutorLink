import { create } from "zustand";

import { nextToasts, type ToastAction, type ToastEntry, type ToastOptions } from "@/lib/toast/toast";

type ToastState = {
  toasts: ToastEntry[];
  add: (message: string, options?: ToastOptions) => void;
  close: (id: string) => void;
  dismiss: (id: string) => void;
};

// Longer than the 150 ms exit so `animationend` normally wins; this only covers reduced
// motion, where no animation runs and no event fires. Dismiss is idempotent, so both may fire.
const EXIT_FALLBACK_MS = 300;

function newlyClosedIds(before: ToastEntry[], after: ToastEntry[]): string[] {
  const wasOpen = new Set(before.filter((toast) => toast.open).map((toast) => toast.id));
  return after.filter((toast) => !toast.open && wasOpen.has(toast.id)).map((toast) => toast.id);
}

// A store rather than a context so a mutation callback can show a toast without a hook.
export const useToastStore = create<ToastState>((set, get) => {
  const apply = (action: ToastAction): void => {
    const before = get().toasts;
    const after = nextToasts(before, action);
    set({ toasts: after });
    for (const id of newlyClosedIds(before, after)) {
      setTimeout(() => get().dismiss(id), EXIT_FALLBACK_MS);
    }
  };

  return {
    toasts: [],
    add: (message, options = {}) => apply({ type: "add", message, ...options }),
    close: (id) => apply({ type: "close", id }),
    dismiss: (id) => apply({ type: "dismiss", id }),
  };
});
