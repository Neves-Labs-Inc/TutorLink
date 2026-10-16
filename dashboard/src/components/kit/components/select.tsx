// The kit's dropdown for short fixed lists: a pill (or inline link) that
// opens a styled listbox, a popover on wide kits and a bottom sheet on
// phones. No label frame: SelectField adds one, or pass aria-label.
import { createPortal } from "react-dom";
import type { KeyboardEvent, MouseEvent, ReactNode, Ref } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { useSelect } from "@/components/kit/hooks/use-select";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { useOverlayHost } from "@/components/kit/overlays/overlay-stack";
import { RISE, useEnterAnimation } from "@/components/kit/overlays/use-enter-animation";
import type {
  SelectChange,
  SelectOption,
} from "@/components/kit/types/select";

// One above the overlay layers (z-50), so the popover paints over an open
// Dialog or sheet in the same host.
const POPOVER_LAYER = "z-[60]";

const FIELD_TRIGGER = "aria-invalid:disabled:border-(--tl-danger) h-11 cursor-pointer rounded-full pr-11 pl-4 text-left";
const INLINE_TRIGGER =
  "-my-2 inline-flex min-w-0 h-11 cursor-pointer items-center gap-1 rounded-full bg-transparent px-1 font-medium text-(--tl-link) underline-offset-4 hover:underline aria-expanded:underline disabled:cursor-not-allowed disabled:text-(--tl-muted) disabled:no-underline";
const POPOVER_PANEL = cn(
  "kit-shadow-raised fixed max-h-72 overflow-y-auto rounded-[20px] border border-(--tl-card-border) bg-(--tl-surface) p-1.5",
  POPOVER_LAYER,
);

type SelectProps = {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (event: SelectChange) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  variant?: "field" | "inline";
  label?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
  className?: string;
};

export default function Select({
  options,
  value,
  defaultValue,
  onChange,
  onValueChange,
  placeholder,
  variant = "field",
  label,
  id,
  name,
  disabled = false,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": isInvalid = false,
  "aria-required": isRequired,
  className,
}: SelectProps): ReactNode {
  const host = useOverlayHost();
  // With a placeholder, a "" option is that prompt, never a choice.
  const listed =
    placeholder === undefined
      ? options
      : options.filter((option) => option.value !== "");
  // Destructured: the compiler lint reads any property of an object that
  // holds refs as a ref read during render.
  const {
    listId,
    getOptionId,
    triggerRef,
    listRef,
    selectedValue,
    selectedIndex,
    activeIndex,
    openMode,
    handleTriggerClick,
    handleTriggerKeyDown,
    handleTriggerKeyUp,
    handleTriggerBlur,
    handleListKeyDown,
    handleListMouseDown,
    setActiveIndex,
    pick,
    dismiss,
  } = useSelect({
    options: listed,
    value,
    defaultValue,
    name,
    isDisabled: disabled,
    onChange,
    onValueChange,
  });
  useEnterAnimation(listRef, openMode === "popover", RISE);
  const isOpen = openMode !== null;
  const isPopover = openMode === "popover";
  const selectedOption = listed[selectedIndex] ?? null;
  const listName = label ?? ariaLabel ?? "";
  const isField = variant === "field";

  const optionList = (isInPopover: boolean): ReactNode => (
    <OptionList
      listRef={listRef}
      listId={listId}
      name={listName}
      options={listed}
      selectedIndex={selectedIndex}
      activeIndex={activeIndex}
      isPopover={isInPopover}
      getOptionId={getOptionId}
      onPick={pick}
      onActivate={setActiveIndex}
      onKeyDown={isInPopover ? undefined : handleListKeyDown}
      onMouseDown={handleListMouseDown}
    />
  );
  const popover = isPopover ? optionList(true) : null;
  const Wrapper = isField ? "div" : "span";

  return (
    <Wrapper className={isField ? "relative" : "relative inline-flex min-w-0"}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={
          isPopover && activeIndex >= 0
            ? getOptionId(activeIndex)
            : undefined
        }
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={isInvalid || undefined}
        aria-required={isRequired}
        disabled={disabled}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKeyDown}
        onKeyUp={handleTriggerKeyUp}
        onBlur={handleTriggerBlur}
        className={cn(
          isField
            ? cn(getControlClasses(isInvalid, isOpen), FIELD_TRIGGER)
            : INLINE_TRIGGER,
          className,
        )}
      >
        <span
          className={cn(
            "block truncate",
            !selectedOption && "text-(--tl-muted)",
          )}
        >
          {selectedOption?.label ?? placeholder}
        </span>
      </button>
      {isField && (
        <ChevronDown
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 right-4 size-[18px] -translate-y-1/2 text-(--tl-muted) transition-transform duration-150",
            isOpen && "rotate-180",
          )}
        />
      )}
      {name !== undefined && (
        <input type="hidden" name={name} value={selectedValue} />
      )}
      {/* Outside a KitRoot there is no host: the popover renders in place. */}
      {popover && !host && popover}
      {popover && host?.element && createPortal(popover, host.element)}
      <BottomSheet
        isOpen={openMode === "sheet"}
        onClose={dismiss}
        title={listName}
      >
        {optionList(false)}
      </BottomSheet>
    </Wrapper>
  );
}

type OptionListProps = {
  listRef: Ref<HTMLUListElement>;
  listId: string;
  name: string;
  options: SelectOption[];
  selectedIndex: number;
  activeIndex: number;
  isPopover: boolean;
  getOptionId: (index: number) => string;
  onPick: (index: number) => void;
  onActivate: (index: number) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLUListElement>) => void;
  onMouseDown: (event: MouseEvent<HTMLUListElement>) => void;
};

// The listbox both modes share. Popover rows pick on mousedown, before
// the trigger could blur; sheet rows hold real focus and pick on click.
function OptionList({
  listRef,
  listId,
  name,
  options,
  selectedIndex,
  activeIndex,
  isPopover,
  getOptionId,
  onPick,
  onActivate,
  onKeyDown,
  onMouseDown,
}: OptionListProps): ReactNode {
  return (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={name}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      className={isPopover ? POPOVER_PANEL : "flex flex-col"}
    >
      {options.length === 0 && (
        <li role="presentation" className="px-3 py-3 text-[14px] text-(--tl-muted)">
          Nothing to pick.
        </li>
      )}
      {options.map((option, index) => {
        const isSelected = index === selectedIndex;
        return (
          <li
            key={option.value}
            id={getOptionId(index)}
            role="option"
            aria-selected={isSelected}
            tabIndex={isPopover ? undefined : -1}
            onMouseDown={isPopover ? () => onPick(index) : undefined}
            onClick={isPopover ? undefined : () => onPick(index)}
            onPointerMove={() => onActivate(index)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2 text-(--tl-ink) transition-colors duration-150 active:bg-(--tl-tint-strong)",
              index === activeIndex && "bg-(--tl-tint)",
            )}
          >
            <span
              className={cn(
                "block min-w-0 flex-1 truncate text-[14px]",
                isSelected ? "font-semibold" : "font-medium",
              )}
            >
              {option.label}
            </span>
            {isSelected && (
              <Check aria-hidden className="size-[18px] shrink-0 text-(--tl-link)" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
