// Short tasks and pickers (filters, account menu, quick actions). A
// bottom sheet on phones; a centred dialog card from 672px.
// Keep it mounted and drive it with isOpen: an overlay the parent
// unmounts on close vanishes without its exit.
import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/components/kit/components/button";
import { SHEET_OR_POP } from "@/components/kit/overlays/use-enter-animation";
import {
  useHeldWhileClosing,
  usePresence,
} from "@/components/kit/overlays/use-presence";
import { OverlayLayer } from "@/components/kit/overlays/overlay-layer";
import { useDialogFocus } from "@/components/kit/overlays/use-dialog-focus";

type BottomSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  children: ReactNode;
};

export function BottomSheet({
  isOpen,
  onClose,
  title,
  description,
  footer,
  children,
}: BottomSheetProps): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogFocus(panelRef, isOpen, onClose);
  const isPresent = usePresence(isOpen, panelRef, SHEET_OR_POP, {
    scrimRef,
  });
  const shown = useHeldWhileClosing(
    { title, description, footer, children },
    isOpen,
  );
  if (!isPresent) return null;

  return (
    <OverlayLayer>
      <div className="fixed inset-0 z-50 flex items-end @2xl:items-center @2xl:justify-center @2xl:p-6">
        <div
          ref={scrimRef}
          aria-hidden
          onClick={onClose}
          className="kit-fade absolute inset-0 bg-(--tl-scrim)"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={shown.description ? descriptionId : undefined}
          tabIndex={-1}
          className="kit-shadow-raised relative flex max-h-[88%] w-full flex-col overflow-hidden rounded-t-[28px] border border-(--tl-card-border) bg-(--tl-surface) outline-none @2xl:max-w-[480px] @2xl:rounded-[28px]"
        >
          <div className="flex justify-center pt-2 @2xl:hidden">
            <span aria-hidden className="h-1.5 w-10 rounded-full bg-(--tl-border)" />
          </div>
          <div className="flex items-start justify-between gap-3 px-5 pt-3 @2xl:px-6 @2xl:pt-6">
            <div>
              <h2
                id={titleId}
                className="kit-display text-[20px] leading-7 font-bold"
              >
                {shown.title}
              </h2>
              {shown.description && (
                <p
                  id={descriptionId}
                  className="mt-0.5 text-[14px] leading-5 text-(--tl-muted)"
                >
                  {shown.description}
                </p>
              )}
            </div>
            <IconButton
              icon={X}
              label="Close"
              onClick={onClose}
              className="-mt-1.5 -mr-2"
            />
          </div>
          <div className="flex-1 overflow-y-auto px-5 pt-4 pb-5 @2xl:px-6">
            {shown.children}
          </div>
          {shown.footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-(--tl-border) px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] @md:flex-row @md:justify-end @2xl:px-6 @2xl:pb-6">
              {shown.footer}
            </div>
          )}
        </div>
      </div>
    </OverlayLayer>
  );
}
