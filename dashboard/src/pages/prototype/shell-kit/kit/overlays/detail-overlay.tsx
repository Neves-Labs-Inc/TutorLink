// Record details (a Booking, a Staff member). From 672px it is a
// slide-over on the right with a scrim. On phones Franklin chose
//   "page"  (A): a full-screen page pushed in from the right, Back ← top left.
//   "sheet" (B, archived): a bottom sheet up to 92% tall.
import { useRef } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, X } from "lucide-react";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { IconButton } from "@/pages/prototype/shell-kit/kit/components/button";
import { useEnterAnimation, PUSH_FROM_RIGHT, RISE_AS_SHEET } from "@/pages/prototype/shell-kit/kit/overlays/use-enter-animation";
import { useDialogFocus } from "@/pages/prototype/shell-kit/kit/overlays/use-dialog-focus";

export type PhoneDetailMode = "page" | "sheet";

type DetailOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  // Back on the phone page; defaults to onClose. Lets a stack of
  // details (Child → Guardian) step back one level.
  onBack?: () => void;
  title: string;
  backLabel: string;
  phoneMode: PhoneDetailMode;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function DetailOverlay({
  isOpen,
  onClose,
  onBack,
  title,
  backLabel,
  phoneMode,
  header,
  footer,
  children,
}: DetailOverlayProps): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);
  const isPage = phoneMode === "page";
  useDialogFocus(panelRef, isOpen, onClose);
  useEnterAnimation(panelRef, isOpen, isPage ? PUSH_FROM_RIGHT : RISE_AS_SHEET);
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "kit-fade absolute inset-0 bg-(--tl-scrim)",
          isPage && "hidden @2xl:block",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          "kit-shadow-raised absolute flex flex-col overflow-hidden outline-none",
          isPage
            ? "inset-0 bg-(--tl-canvas)"
            : "inset-x-0 bottom-0 max-h-[92%] rounded-t-[28px] border border-(--tl-card-border) bg-(--tl-surface)",
          "@2xl:inset-y-4 @2xl:right-4 @2xl:bottom-4 @2xl:left-auto @2xl:max-h-none @2xl:w-[440px] @2xl:rounded-[28px] @2xl:border @2xl:border-(--tl-card-border) @2xl:bg-(--tl-surface)",
        )}
      >
        {isPage ? (
          <div className="flex h-14 shrink-0 items-center gap-1 border-b border-(--tl-border) bg-(--tl-surface) px-1 @2xl:hidden">
            <button
              type="button"
              onClick={onBack ?? onClose}
              className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-full pr-4 pl-2 text-[15px] font-medium text-(--tl-link) hover:bg-(--tl-tint)"
            >
              <ArrowLeft aria-hidden className="size-5" />
              {backLabel}
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 justify-center pt-2 @2xl:hidden">
            <span
              aria-hidden
              className="h-1.5 w-10 rounded-full bg-(--tl-border)"
            />
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-start justify-between gap-3 px-5 pt-4 @2xl:px-6 @2xl:pt-6">
            <div className="min-w-0 flex-1">{header}</div>
            <span className={cn("-mt-1 -mr-2", isPage && "hidden @2xl:block")}>
              <IconButton icon={X} label="Close" onClick={onClose} />
            </span>
          </div>
          <div className="px-5 pt-2 pb-6 @2xl:px-6">{children}</div>
        </div>
        {footer && (
          <div className="flex shrink-0 flex-col gap-2 border-t border-(--tl-border) bg-(--tl-surface) px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] @md:flex-row @2xl:px-6 @2xl:pb-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
