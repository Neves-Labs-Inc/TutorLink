// Toasts: bottom-centre above the tab bar on phones, bottom-right on
// desktop. Success and info are polite; errors interrupt (role="alert").
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { RISE } from "@/components/kit/overlays/use-enter-animation";
import { usePresence } from "@/components/kit/overlays/use-presence";
import { ToastContext } from "@/components/kit/overlays/use-toast";
import type { ToastInput, ToastTone } from "@/components/kit/overlays/use-toast";

const TOAST_MS = 5000;
export const TOAST_WITH_ACTION_MS = 8000;
const MAX_TOASTS = 3;

// A leaving toast plays its exit, then removes itself from the list.
type Toast = ToastInput & { id: number; isLeaving: boolean };

const TONE_ICON: Record<ToastTone, { icon: LucideIcon; classes: string }> = {
  success: {
    icon: CircleCheck,
    classes: "bg-(--tl-success-tint) text-(--tl-success)",
  },
  error: {
    icon: CircleAlert,
    classes: "bg-(--tl-danger-tint) text-(--tl-danger)",
  },
  info: { icon: Info, classes: "bg-(--tl-info-tint) text-(--tl-info)" },
};

function clearTimer(timers: Map<number, number>, id: number): void {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
}

type ToastProviderProps = { children: ReactNode };

export default function ToastProvider({
  children,
}: ToastProviderProps): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timersRef = useRef(new Map<number, number>());

  // Starts the toast's exit; it removes itself once the exit has played.
  const dismiss = useCallback((id: number): void => {
    clearTimer(timersRef.current, id);
    setToasts((current) =>
      current.map((toast) =>
        toast.id === id ? { ...toast, isLeaving: true } : toast,
      ),
    );
  }, []);

  const remove = useCallback((id: number): void => {
    // An evicted toast's timer is still pending; it ends with the toast.
    clearTimer(timersRef.current, id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (input: ToastInput): void => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => {
        // Leaving toasts don't count toward the max; the oldest live ones
        // make room by leaving.
        const live = current.filter((toast) => !toast.isLeaving);
        const overflow = Math.max(0, live.length - MAX_TOASTS + 1);
        const evicted = live.slice(0, overflow);
        const kept = current.map((toast) =>
          evicted.includes(toast) ? { ...toast, isLeaving: true } : toast,
        );
        return [...kept, { ...input, id, isLeaving: false }];
      });
      const lifetime = input.actionLabel ? TOAST_WITH_ACTION_MS : TOAST_MS;
      timersRef.current.set(
        id,
        window.setTimeout(() => dismiss(id), lifetime),
      );
    },
    [dismiss],
  );

  const api = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-[104px] z-[60] flex flex-col items-center gap-2 @5xl:inset-x-auto @5xl:right-6 @5xl:bottom-6 @5xl:w-[400px] @5xl:items-stretch">
        {toasts.map((toast) => (
          <ToastCard
            key={toast.id}
            toast={toast}
            onDismiss={dismiss}
            onRemove={remove}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

type ToastCardProps = {
  toast: Toast;
  onDismiss: (id: number) => void;
  onRemove: (id: number) => void;
};

function ToastCard({
  toast,
  onDismiss,
  onRemove,
}: ToastCardProps): ReactNode {
  const tone = TONE_ICON[toast.tone];
  const Icon = tone.icon;
  const cardRef = useRef<HTMLDivElement>(null);
  const isPresent = usePresence(!toast.isLeaving, cardRef, RISE);
  const { id } = toast;

  useEffect(() => {
    if (!isPresent) onRemove(id);
  }, [isPresent, id, onRemove]);

  function handleAction(): void {
    toast.onAction?.();
    onDismiss(toast.id);
  }

  if (!isPresent) return null;

  return (
    <div
      ref={cardRef}
      role={toast.tone === "error" ? "alert" : "status"}
      inert={toast.isLeaving}
      aria-hidden={toast.isLeaving || undefined}
      className={cn(
        "kit-shadow-raised flex w-full max-w-[400px] items-center gap-3 rounded-[20px] bg-(--tl-inverse) py-2 pr-2 pl-3 text-(--tl-on-inverse)",
        toast.isLeaving ? "pointer-events-none" : "pointer-events-auto",
      )}
    >
      <span
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-full",
          tone.classes,
        )}
      >
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <p className="min-w-0 flex-1 py-1.5 text-[14px] leading-5 font-medium">
        {toast.message}
      </p>
      {toast.actionLabel && (
        <button
          type="button"
          onClick={handleAction}
          className="h-11 shrink-0 rounded-full px-3 text-[14px] font-semibold text-(--tl-inverse-link) hover:bg-(--tl-on-inverse)/10"
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-full opacity-80 hover:bg-(--tl-on-inverse)/10 hover:opacity-100"
      >
        <X aria-hidden className="size-[18px]" />
      </button>
    </div>
  );
}
