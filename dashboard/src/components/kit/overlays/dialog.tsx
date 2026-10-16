// Centred modal dialogs. ConfirmDialog names the act on both buttons
// ("Cancel booking" / "Keep booking"), never a bare OK/Cancel, so
// "cancel" can't mean two things at once.
// Keep it mounted and drive it with isOpen: an overlay the parent
// unmounts on close vanishes without its exit.
import { useId, useRef } from "react";
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { POP } from "@/components/kit/overlays/use-enter-animation";
import {
  useHeldWhileClosing,
  usePresence,
} from "@/components/kit/overlays/use-presence";
import { OverlayLayer } from "@/components/kit/overlays/overlay-layer";
import { useDialogFocus } from "@/components/kit/overlays/use-dialog-focus";

type DialogProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  footer: ReactNode;
  role?: "dialog" | "alertdialog";
  children: ReactNode;
};

export function Dialog({
  isOpen,
  onClose,
  title,
  icon,
  footer,
  role = "dialog",
  children,
}: DialogProps): ReactNode {
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useDialogFocus(panelRef, isOpen, onClose);
  const isPresent = usePresence(isOpen, panelRef, POP, { scrimRef });
  const shown = useHeldWhileClosing(
    { title, icon, footer, role, children },
    isOpen,
  );
  if (!isPresent) return null;

  return (
    <OverlayLayer>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={scrimRef}
          aria-hidden
          onClick={onClose}
          className="kit-fade absolute inset-0 bg-(--tl-scrim)"
        />
        <div
          ref={panelRef}
          role={shown.role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          tabIndex={-1}
          className="kit-shadow-raised relative w-full max-w-[440px] rounded-[28px] border border-(--tl-card-border) bg-(--tl-surface) p-6 outline-none"
        >
          {shown.icon}
          <h2
            id={titleId}
            className="kit-display text-[22px] leading-[30px] font-bold"
          >
            {shown.title}
          </h2>
          <div
            id={bodyId}
            className="mt-2 text-[15px] leading-6 text-(--tl-ink-soft)"
          >
            {shown.children}
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 @md:flex-row @md:justify-end">
            {shown.footer}
          </div>
        </div>
      </div>
    </OverlayLayer>
  );
}

type ConfirmDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  confirmLabel: string;
  keepLabel: string;
  isDestructive?: boolean;
  isWorking?: boolean;
  children: ReactNode;
};

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  keepLabel,
  isDestructive = false,
  isWorking = false,
  children,
}: ConfirmDialogProps): ReactNode {
  const icon = isDestructive ? (
    <span className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-(--tl-danger-tint) text-(--tl-danger)">
      <TriangleAlert aria-hidden className="size-6" />
    </span>
  ) : null;
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={icon}
      role={isDestructive ? "alertdialog" : "dialog"}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isWorking}>
            {keepLabel}
          </Button>
          <Button
            variant={isDestructive ? "danger" : "primary"}
            onClick={onConfirm}
            isLoading={isWorking}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
