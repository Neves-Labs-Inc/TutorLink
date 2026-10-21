// A searchable single-choice picker (ARIA combobox + listbox) for long
// lists like Staff or Children. From 672px of kit width the list opens
// in-flow under the trigger; on phones, in a bottom sheet with its own
// search. Arrow keys move, Enter picks, Escape closes. Options can carry
// an avatar and a second line.
import type { ReactNode, Ref } from "react";
import { Check, ChevronDown, CircleAlert } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { Avatar } from "@/components/kit/components/badges";
import { SearchInput } from "@/components/kit/components/fields";
import { useCombobox } from "@/components/kit/hooks/use-combobox";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import {
  LIST_ENTER_MS,
  RISE,
} from "@/components/kit/overlays/use-enter-animation";
import { usePresence } from "@/components/kit/overlays/use-presence";
import type { ComboboxOption } from "@/components/kit/types/combobox";

const LISTBOX_PANEL =
  "kit-shadow-raised absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-72 overflow-y-auto rounded-[20px] border border-(--tl-card-border) bg-(--tl-surface) p-1.5";
// Tall enough that the sheet keeps its height as matches narrow.
const SHEET_LIST = "flex min-h-72 flex-col";
const NOTE_ROW = "px-3 py-3 text-[14px] text-(--tl-muted)";

function getNoMatchText(query: string): string {
  return `No matches for “${query.trim()}”.`;
}

// For the polite live line: silent until there is a query to count for.
function getCountText(query: string, count: number): string {
  if (query.trim() === "") return "";

  let text = count === 1 ? "1 match" : `${count} matches`;
  if (count === 0) text = getNoMatchText(query);
  return text;
}

type ComboboxProps = {
  label: string;
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: string;
  error?: string;
  isRequired?: boolean;
  // Shown, greyed, while its options load.
  isDisabled?: boolean;
  // What the list says when there is nothing to pick at all.
  emptyText?: string;
};

export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder = "Search",
  help,
  error,
  isRequired = false,
  isDisabled = false,
  emptyText = "Nothing to pick.",
}: ComboboxProps): ReactNode {
  // Destructured: the compiler lint reads any property of an object that
  // holds refs as a ref read during render.
  const {
    listId,
    getOptionId,
    triggerRef,
    searchRef,
    listRef,
    sheetListRef,
    mode,
    query,
    matches,
    activeIndex,
    activeOption,
    setActiveIndex,
    changeQuery,
    pick,
    close,
    handleTriggerChange,
    handleTriggerMouseDown,
    handleTriggerClick,
    handleTriggerFocus,
    handleTriggerBlur,
    handleTriggerKeyDown,
    handleSearchKeyDown,
  } = useCombobox({ options, value, onChange });
  const id = `${listId}-trigger`;
  const messageId = `${listId}-message`;
  const selected = options.find((option) => option.value === value) ?? null;
  const isOpen = mode !== null;
  const isListbox = mode === "listbox";
  const isListPresent = usePresence(isListbox, listRef, RISE, {
    enterMs: LIST_ENTER_MS,
  });
  // Playing its exit: no id, so nothing points assistive tech into it.
  const isListLeaving = isListPresent && !isListbox;
  const hasAvatar = Boolean(selected?.hasAvatar) && !isListbox;
  const activeId = activeOption ? getOptionId(activeOption) : undefined;
  const countText = getCountText(query, matches.length);
  const message = error ?? help;

  const optionList = (
    listRefFor: Ref<HTMLUListElement>,
    isInSheet: boolean,
    isLeaving = false,
  ): ReactNode => (
    <OptionList
      listRef={listRefFor}
      id={isLeaving ? undefined : listId}
      label={label}
      options={matches}
      noMatchText={options.length === 0 ? emptyText : getNoMatchText(query)}
      value={value}
      activeIndex={activeIndex}
      isInSheet={isInSheet}
      isLeaving={isLeaving}
      getOptionId={getOptionId}
      onPick={pick}
      onActivate={setActiveIndex}
      className={isInSheet ? SHEET_LIST : LISTBOX_PANEL}
    />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[14px] leading-5 font-semibold text-(--tl-ink)"
      >
        {label}
        {isRequired ? (
          <span className="font-normal text-(--tl-muted)"> (required)</span>
        ) : null}
      </label>
      <div className="relative">
        {selected && hasAvatar && (
          <span className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2">
            <Avatar name={selected.label} size="sm" />
          </span>
        )}
        <input
          ref={triggerRef}
          id={id}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={isListbox ? activeId : undefined}
          aria-describedby={message ? messageId : undefined}
          aria-invalid={error ? true : undefined}
          disabled={isDisabled}
          value={isListbox ? query : (selected?.label ?? "")}
          placeholder={selected && isListbox ? selected.label : placeholder}
          onChange={(event) => handleTriggerChange(event.target.value)}
          onMouseDown={handleTriggerMouseDown}
          onClick={handleTriggerClick}
          onFocus={handleTriggerFocus}
          onBlur={handleTriggerBlur}
          onKeyDown={handleTriggerKeyDown}
          className={cn(
            getControlClasses(Boolean(error), isOpen),
            "h-11 rounded-full pr-11",
            hasAvatar ? "pl-12" : "pl-4",
          )}
        />
        <ChevronDown
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 right-4 size-[18px] -translate-y-1/2 text-(--tl-muted) transition-transform duration-150 motion-reduce:transition-none",
            isOpen && "rotate-180",
          )}
        />
        {isListPresent && optionList(listRef, false, isListLeaving)}
        <p role="status" className="sr-only">
          {isListbox ? countText : ""}
        </p>
      </div>
      {message && (
        <p
          id={messageId}
          className={cn(
            "flex items-start gap-1.5 px-1 text-[13px] leading-[18px]",
            error ? "font-medium text-(--tl-danger)" : "text-(--tl-muted)",
          )}
        >
          {error && <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />}
          {message}
        </p>
      )}
      <BottomSheet isOpen={mode === "sheet"} onClose={close} title={label}>
        {/* Pinned over the body's top padding: it sticks at its own
            -1rem margin, so it never shifts down over the first row. */}
        <div className="sticky -top-4 z-10 -mx-5 -mt-4 bg-(--tl-surface) px-5 pt-4 pb-3">
          <SearchInput
            ref={searchRef}
            label={`Search ${label}`}
            placeholder={placeholder}
            value={query}
            onChange={changeQuery}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            onKeyDown={handleSearchKeyDown}
          />
        </div>
        {optionList(sheetListRef, true)}
        <p role="status" className="sr-only">
          {countText}
        </p>
      </BottomSheet>
    </div>
  );
}

type OptionListProps = {
  listRef: Ref<HTMLUListElement>;
  id: string | undefined;
  label: string;
  options: ComboboxOption[];
  noMatchText: string;
  value: string | null;
  activeIndex: number;
  isInSheet: boolean;
  // Playing its exit: out of reach for clicks and assistive tech.
  isLeaving: boolean;
  getOptionId: (option: ComboboxOption) => string;
  onPick: (option: ComboboxOption) => void;
  onActivate: (index: number) => void;
  className: string;
};

// The listbox both modes share. In-flow rows pick on mousedown; sheet
// rows pick on click.
function OptionList({
  listRef,
  id,
  label,
  options,
  noMatchText,
  value,
  activeIndex,
  isInSheet,
  isLeaving,
  getOptionId,
  onPick,
  onActivate,
  className,
}: OptionListProps): ReactNode {
  return (
    <ul
      ref={listRef}
      id={id}
      role="listbox"
      aria-label={label}
      inert={isLeaving}
      aria-hidden={isLeaving || undefined}
      className={cn(className, isLeaving && "pointer-events-none")}
    >
      {options.length === 0 && (
        <li role="presentation" className={NOTE_ROW}>
          {noMatchText}
        </li>
      )}
      {options.map((option, index) => {
        const isSelected = option.value === value;
        return (
          <li
            key={option.value}
            id={getOptionId(option)}
            role="option"
            aria-selected={isSelected}
            // Never takes focus from the trigger or the sheet's search.
            // In-flow rows pick here, before the trigger could blur.
            onMouseDown={(event) => {
              event.preventDefault();
              if (!isInSheet) onPick(option);
            }}
            onClick={isInSheet ? () => onPick(option) : undefined}
            onPointerMove={() => onActivate(index)}
            className={cn(
              "flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2 text-(--tl-ink) transition-colors duration-150 active:bg-(--tl-tint-strong)",
              index === activeIndex && "bg-(--tl-tint)",
            )}
          >
            {option.hasAvatar && <Avatar name={option.label} size="sm" />}
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-[14px]",
                  isSelected ? "font-semibold" : "font-medium",
                )}
              >
                {option.label}
              </span>
              {option.description && (
                <span className="block truncate text-[13px] text-(--tl-muted)">
                  {option.description}
                </span>
              )}
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
