// The ⋯ menu on a record's details: a short list of the less common
// acts (invite, archive...). A bottom sheet on phones, a small card on
// desktop, as the kit uses for quick actions. A disabled act says why.
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";

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

export default function ActionsSheet({
  isOpen,
  title,
  actions,
  onClose,
}: ActionsSheetProps): ReactNode {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <ul className="-mx-2 flex flex-col">
        {actions.map((action) => {
          const Icon = action.icon;
          const isDisabled = Boolean(action.disabledReason);
          return (
            <li key={action.id}>
              <button
                type="button"
                disabled={isDisabled}
                onClick={() => {
                  onClose();
                  action.onSelect();
                }}
                className={cn(
                  "flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[16px] px-3 py-2 text-left transition-colors duration-150 hover:enabled:bg-(--tl-tint) disabled:cursor-not-allowed",
                  action.isDanger && !isDisabled && "text-(--tl-danger)",
                  isDisabled && "text-(--tl-muted)",
                )}
              >
                <Icon aria-hidden className="size-5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[15px] leading-6 font-medium">
                    {action.label}
                  </span>
                  {(action.disabledReason ?? action.description) && (
                    <span className="block text-[13px] leading-[18px] text-(--tl-muted)">
                      {action.disabledReason ?? action.description}
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
