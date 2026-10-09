import { cn } from "@/lib/utils";

// The Toaster look. Lives outside the component file because react-refresh wants component
// files to export components only (same arrangement as lib/dialog/dialogClasses.ts).

// Empty, it has no size beyond its gap and blocks no taps; each toast re-enables pointer events.
// Below md the tutor chrome's tab bar (~69px) needs the taller offset; md+ has no tab bar.
export const toastViewportClasses = cn(
  "pointer-events-none fixed inset-x-4 z-[60] flex flex-col gap-2 outline-none",
  "bottom-[calc(1rem+env(safe-area-inset-bottom))]",
  "max-md:data-[above-tab-bar=true]:bottom-[calc(5rem+env(safe-area-inset-bottom))]",
  "md:inset-x-auto md:right-4 md:bottom-4 md:w-96 md:max-w-[calc(100vw-2rem)]",
);

export const toastRootClasses = cn(
  "pointer-events-auto flex items-start gap-3 rounded-lg bg-card p-3 pl-4 text-sm transition-none",
  "text-card-foreground shadow-md ring-1 ring-foreground/10",
  "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2",
  "data-[state=open]:duration-200 data-[state=open]:ease-out",
  "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150",
  "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
  "data-[swipe=cancel]:translate-x-0 data-[swipe=cancel]:transition-transform",
  "data-[swipe=cancel]:duration-200 data-[swipe=cancel]:ease-out",
  "data-[swipe=end]:animate-out data-[swipe=end]:fade-out-0 data-[swipe=end]:slide-out-to-right",
  "data-[swipe=end]:duration-150",
  "motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
  "motion-reduce:data-[swipe=end]:animate-none motion-reduce:transition-none",
  "motion-reduce:data-[swipe=cancel]:transition-none",
);

// py-1 lines the text up with the centre of the 32px / 44px Dismiss button.
export const toastTitleClasses = "min-w-0 flex-1 break-words py-1";

export const toastIconClasses = "mt-0.5 size-4 shrink-0 text-status-confirmed";

// Negative margins keep the card's 12px padding while the hit area grows to 44px below md.
export const toastDismissClasses = cn(
  "-my-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg",
  "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
  "active:translate-y-px focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
  "md:-my-1 md:-mr-1 md:size-8",
);
