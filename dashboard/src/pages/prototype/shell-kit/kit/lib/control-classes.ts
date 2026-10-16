// The kit's field outline, shared by the text-like fields and the Select
// trigger.
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";

const CONTROL =
  "w-full border bg-(--tl-surface) text-[15px] text-(--tl-ink) transition-colors duration-150 placeholder:text-(--tl-muted) disabled:cursor-not-allowed disabled:border-(--tl-border) disabled:bg-(--tl-surface-sunk) disabled:text-(--tl-muted)";

// `isActive` holds the hover colour, for a control whose list is open.
// An error keeps the danger border either way.
export function getControlClasses(
  hasError: boolean,
  isActive = false,
): string {
  let border = "border-(--tl-field-border) hover:border-(--tl-primary)";
  if (hasError) {
    border = "border-(--tl-danger) hover:border-(--tl-danger)";
  } else if (isActive) {
    border = "border-(--tl-primary)";
  }
  return cn(CONTROL, border);
}
