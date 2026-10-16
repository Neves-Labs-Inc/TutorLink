// The kit's field outline, for the custom inputs the kit has no field for.
import { cn } from "@/pages/prototype/shell-kit/kit/tokens";

export function getControlClasses(hasError: boolean): string {
  return cn(
    "h-11 rounded-full border bg-(--tl-surface) text-[15px] text-(--tl-ink) transition-colors duration-150 placeholder:text-(--tl-muted) disabled:cursor-not-allowed disabled:border-(--tl-border) disabled:bg-(--tl-surface-sunk) disabled:text-(--tl-muted)",
    hasError
      ? "border-(--tl-danger) hover:border-(--tl-danger)"
      : "border-(--tl-field-border) hover:border-(--tl-primary)",
  );
}
