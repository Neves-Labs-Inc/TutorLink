// The ⋯ menu on a record's details: a short list of the less common
// acts (edit, archive...). A bottom sheet on phones, a small card on
// desktop. A disabled act says why. The menu closes first and the
// chosen act runs once its exit has played, so the next sheet never
// opens over it; focus is back on ⋯ by then.
// Promoted from the accounts-staff prototype (Families 06/08, Staff 08).
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { EXIT_MS } from "@/components/kit/overlays/use-enter-animation";

export type SheetAction = {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  description?: string;
  isDanger?: boolean;
  disabledReason?: string;
};

type ActionsSheetProps = {
  isOpen: boolean;
  title: string;
  actions: SheetAction[];
  onClose: () => void;
};

export function ActionsSheet({
  isOpen,
  title,
  actions,
  onClose,
}: ActionsSheetProps): ReactNode {
  function handleSelect(action: SheetAction): void {
    onClose();
    window.setTimeout(action.onSelect, EXIT_MS);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <ul className="-mx-2 flex flex-col">
        {actions.map((action) => {
          const Icon = action.icon;
          const isDisabled = Boolean(action.disabledReason);
          const note = action.disabledReason ?? action.description;
          return (
            <li key={action.id}>
              <button
                type="button"
                data-more-row
                disabled={isDisabled}
                onClick={() => handleSelect(action)}
                className={cn(
                  "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[18px] px-3 py-2 text-left transition-colors duration-150 hover:enabled:bg-(--tl-tint) enabled:active:bg-(--tl-tint-strong) disabled:cursor-not-allowed",
                  action.isDanger && !isDisabled && "text-(--tl-danger)",
                  isDisabled && "text-(--tl-muted)",
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[15px] leading-6 font-medium">
                    {action.label}
                  </span>
                  {note && (
                    <span className="block text-[13px] leading-[18px] text-(--tl-muted)">
                      {note}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
}
