// A one-tap on/off filter ("Mine") that sits beside the multi-select
// dropdowns and shares their pill look and active style.
import type { ReactNode } from "react";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/components/kit/tokens";

type QuickFilterProps = {
  label: string;
  isOn: boolean;
  onToggle: () => void;
  icon?: LucideIcon;
};

export function QuickFilter({
  label,
  isOn,
  onToggle,
  icon: Icon,
}: QuickFilterProps): ReactNode {
  const ShownIcon = isOn ? Check : Icon;
  return (
    <button
      type="button"
      aria-pressed={isOn}
      onClick={onToggle}
      className={cn(
        "inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border px-4 text-[14px] whitespace-nowrap transition-colors duration-150",
        isOn
          ? "border-(--tl-primary) bg-(--tl-tint-strong) font-semibold text-(--tl-primary-ink)"
          : "border-(--tl-border) bg-(--tl-surface) font-medium text-(--tl-ink-soft) hover:bg-(--tl-tint)",
      )}
    >
      {ShownIcon && <ShownIcon aria-hidden className="size-4" />}
      {label}
    </button>
  );
}
