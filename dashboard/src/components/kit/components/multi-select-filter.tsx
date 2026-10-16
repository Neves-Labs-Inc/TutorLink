// One filter per field ("Status ▾"): a pill trigger that opens a
// checkbox list. The trigger shows how many are on ("Status · 2").
// From 672px of kit width the list is a popover under the trigger;
// narrower than that it opens as a bottom sheet, where a popover is
// too cramped. Escape or a click outside closes the popover and focus
// returns to the trigger; Tab out of it closes it too.
import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { Button } from "@/components/kit/components/button";
import { CheckboxField } from "@/components/kit/components/choices";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { RISE } from "@/components/kit/overlays/use-enter-animation";
import { usePresence } from "@/components/kit/overlays/use-presence";

export type FilterOption = { value: string; label: string; count?: number };

type MultiSelectFilterProps = {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
};

// Same breakpoint as @2xl, where slide-overs and dialogs switch too.
const POPOVER_MIN_KIT_WIDTH = 672;
const POPOVER_WIDTH = 288;

type OpenMode = "popover" | "sheet" | null;

export function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
}: MultiSelectFilterProps): ReactNode {
  const [openMode, setOpenMode] = useState<OpenMode>(null);
  const [isAlignedRight, setIsAlignedRight] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const count = selected.length;
  const isActive = count > 0;
  const isPopoverOpen = openMode === "popover";
  const isPopoverPresent = usePresence(isPopoverOpen, popoverRef, RISE);
  // Playing its exit: out of reach for clicks, keys and assistive tech.
  const isPopoverLeaving = isPopoverPresent && !isPopoverOpen;

  function close(): void {
    setOpenMode(null);
    triggerRef.current?.focus();
  }

  function handleToggleOpen(): void {
    if (openMode) {
      setOpenMode(null);
      return;
    }
    const root = wrapperRef.current?.closest("[data-kit]");
    const trigger = triggerRef.current;
    if (!root || !trigger) return;
    const rootRect = root.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    setIsAlignedRight(triggerRect.left + POPOVER_WIDTH > rootRect.right - 16);
    setOpenMode(rootRect.width >= POPOVER_MIN_KIT_WIDTH ? "popover" : "sheet");
  }

  function toggleValue(value: string, isChecked: boolean): void {
    onChange(
      isChecked
        ? [...selected, value]
        : selected.filter((item) => item !== value),
    );
  }

  // Close only when focus Tabs to something outside. A click on a row's
  // text blurs the checkbox with no new target (relatedTarget is null);
  // closing then swallowed the click. Clicks outside are handled by the
  // pointerdown listener below.
  function handleBlur(event: FocusEvent<HTMLDivElement>): void {
    if (openMode !== "popover") return;
    const next = event.relatedTarget;
    if (!(next instanceof Node) || wrapperRef.current?.contains(next)) return;
    setOpenMode(null);
  }

  useEffect(() => {
    if (openMode !== "popover") return;
    popoverRef.current?.querySelector("input")?.focus();

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) return;
      setOpenMode(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [openMode]);

  const list = (
    <fieldset className="flex flex-col">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <CheckboxField
          key={option.value}
          label={option.count === undefined ? option.label : `${option.label} (${option.count})`}
          isChecked={selected.includes(option.value)}
          onChange={(isChecked) => toggleValue(option.value, isChecked)}
        />
      ))}
    </fieldset>
  );

  return (
    <div
      ref={wrapperRef}
      onBlur={handleBlur}
      onKeyDown={(event) => {
        if (event.key === "Escape" && openMode === "popover") {
          event.stopPropagation();
          close();
        }
      }}
      className="relative shrink-0"
    >
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={openMode !== null}
        aria-controls={openMode === "popover" ? popoverId : undefined}
        aria-haspopup="dialog"
        onClick={handleToggleOpen}
        className={cn(
          "inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border pr-3 pl-4 text-[14px] whitespace-nowrap transition-colors duration-150",
          isActive
            ? "border-(--tl-primary) bg-(--tl-tint-strong) font-semibold text-(--tl-primary-ink)"
            : "border-(--tl-border) bg-(--tl-surface) font-medium text-(--tl-ink-soft) hover:bg-(--tl-tint)",
        )}
      >
        <span className="tabular-nums">
          {label}
          {isActive && (
            <>
              <span aria-hidden> · </span>
              {count}
              <span className="sr-only"> selected</span>
            </>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 transition-transform duration-150",
            openMode && "rotate-180",
          )}
        />
      </button>

      {isPopoverPresent && (
        <div
          ref={popoverRef}
          id={popoverId}
          role="dialog"
          aria-label={`Filter by ${label}`}
          inert={isPopoverLeaving}
          aria-hidden={isPopoverLeaving || undefined}
          style={{ width: POPOVER_WIDTH }}
          className={cn(
            "kit-shadow-raised absolute top-[calc(100%+8px)] z-40 rounded-[20px] border border-(--tl-card-border) bg-(--tl-surface) p-2",
            isAlignedRight ? "right-0" : "left-0",
            isPopoverLeaving && "pointer-events-none",
          )}
        >
          <div className="max-h-72 overflow-y-auto px-2">{list}</div>
          <div className="mt-1 flex justify-between gap-2 border-t border-(--tl-border) px-1 pt-2">
            <Button
              variant="ghost"
              onClick={() => onChange([])}
              disabled={!isActive}
            >
              Clear
            </Button>
            <Button variant="soft" onClick={close}>
              Done
            </Button>
          </div>
        </div>
      )}

      <BottomSheet
        isOpen={openMode === "sheet"}
        onClose={() => setOpenMode(null)}
        title={label}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => onChange([])}
              disabled={!isActive}
            >
              Clear
            </Button>
            <Button variant="primary" onClick={() => setOpenMode(null)}>
              Done
            </Button>
          </>
        }
      >
        {list}
      </BottomSheet>
    </div>
  );
}
