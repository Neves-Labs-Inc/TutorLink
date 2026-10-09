import { Toast } from "radix-ui";
import { Check, X } from "lucide-react";

import {
  toastDismissClasses,
  toastIconClasses,
  toastRootClasses,
  toastTitleClasses,
  toastViewportClasses,
} from "@/lib/toast/toastClasses";
import { useToastStore } from "@/stores/toastStore";

type ToasterProps = {
  aboveTabBar?: boolean;
};

export default function Toaster({ aboveTabBar = false }: ToasterProps): React.ReactNode {
  const toasts = useToastStore((state) => state.toasts);
  const close = useToastStore((state) => state.close);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <Toast.Provider swipeDirection="right">
      {toasts.map((toast) => (
        <Toast.Root
          key={toast.id}
          open={toast.open}
          duration={toast.durationMs}
          onOpenChange={(open) => !open && close(toast.id)}
          // Closing keeps the entry mounted so Radix Presence can play the exit; remove it
          // once that animation ends (the store's timeout covers reduced motion).
          onAnimationEnd={(event) => {
            if (event.currentTarget.dataset.state === "closed") dismiss(toast.id);
          }}
          className={toastRootClasses}
        >
          {toast.tone === "success" && <Check aria-hidden="true" className={toastIconClasses} />}
          <Toast.Title className={toastTitleClasses}>{toast.message}</Toast.Title>
          <Toast.Close type="button" aria-label="Dismiss" className={toastDismissClasses}>
            <X aria-hidden="true" className="size-4" />
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport data-above-tab-bar={aboveTabBar} className={toastViewportClasses} />
    </Toast.Provider>
  );
}
