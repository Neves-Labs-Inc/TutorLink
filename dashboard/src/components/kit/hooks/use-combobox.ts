// State for the kit Combobox, an APG editable combobox: the query and
// its matches, the active option, keys, and which mode is open. From
// 672px of kit width the list is in-flow under the trigger and typing
// happens in the trigger; narrower, it opens a bottom sheet with its own
// search, and a press never focuses the trigger on the way in.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, RefObject } from "react";
import { isKitWide } from "@/components/kit/overlays/use-enter-animation";
import type {
  ComboboxMode,
  ComboboxOption,
} from "@/components/kit/types/combobox";

function filterOptions(
  options: ComboboxOption[],
  query: string,
): ComboboxOption[] {
  const needle = query.trim().toLowerCase();
  return options.filter(
    (option) =>
      needle === "" ||
      option.label.toLowerCase().includes(needle) ||
      option.description?.toLowerCase().includes(needle),
  );
}

function isPrintable(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}

// Scrolls only the list's own scroller, never the kit around it. In the
// sheet, the pinned search covers the scroller's top edge.
function revealRow(scroller: HTMLElement, row: HTMLElement, coveredTop: number): void {
  const box = scroller.getBoundingClientRect();
  const rowBox = row.getBoundingClientRect();
  const visibleTop = Math.max(box.top, coveredTop);
  if (rowBox.top < visibleTop) {
    scroller.scrollTop -= visibleTop - rowBox.top;
  } else if (rowBox.bottom > box.bottom) {
    scroller.scrollTop += rowBox.bottom - box.bottom;
  }
}

// On a phone, focus comes back to the trigger after the sheet; with no
// input mode the soft keyboard would open over the form. A hardware
// keyboard still opens the sheet by typing there.
function setTriggerInputMode(trigger: HTMLInputElement, isWide: boolean): void {
  if (isWide) {
    trigger.removeAttribute("inputmode");
  } else {
    trigger.setAttribute("inputmode", "none");
  }
}

// The list's height when the sheet opens, capped at what its scroller
// shows below the pinned search: never taller than the sheet itself.
function getSheetListHeight(list: HTMLElement): number {
  const scroller = list.parentElement;
  if (!scroller) return list.offsetHeight;

  const scrollerBox = scroller.getBoundingClientRect();
  const listTop = list.getBoundingClientRect().top + scroller.scrollTop;
  const paddingBottom = parseFloat(getComputedStyle(scroller).paddingBottom);
  const visible =
    scroller.clientHeight - (listTop - scrollerBox.top) - paddingBottom;
  return Math.min(list.offsetHeight, visible);
}

type UseComboboxArgs = {
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
};

type ComboboxState = {
  listId: string;
  getOptionId: (option: ComboboxOption) => string;
  triggerRef: RefObject<HTMLInputElement | null>;
  searchRef: RefObject<HTMLInputElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
  sheetListRef: RefObject<HTMLUListElement | null>;
  mode: ComboboxMode;
  query: string;
  matches: ComboboxOption[];
  activeIndex: number;
  activeOption: ComboboxOption | null;
  setActiveIndex: (index: number) => void;
  changeQuery: (query: string) => void;
  pick: (option: ComboboxOption) => void;
  close: () => void;
  handleTriggerChange: (text: string) => void;
  handleTriggerMouseDown: (event: MouseEvent<HTMLInputElement>) => void;
  handleTriggerClick: () => void;
  handleTriggerFocus: () => void;
  handleTriggerBlur: () => void;
  handleTriggerKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  handleSearchKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};

export function useCombobox({
  options,
  value,
  onChange,
}: UseComboboxArgs): ComboboxState {
  const listId = useId();
  const triggerRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const sheetListRef = useRef<HTMLUListElement>(null);
  // Whether closing hands focus back to the trigger (the sheet held it).
  const shouldRefocusRef = useRef(false);
  const [mode, setMode] = useState<ComboboxMode>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const matches = filterOptions(options, query);
  const activeOption = matches[activeIndex] ?? null;

  function getOptionId(option: ComboboxOption): string {
    return `${listId}-${option.value}`;
  }

  // The query resets here, not on close, so a leaving list keeps the
  // rows it had.
  function open(seed = ""): void {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const selectedIndex = filterOptions(options, seed).findIndex(
      (option) => option.value === value,
    );
    const isWide = isKitWide(trigger);
    setTriggerInputMode(trigger, isWide);
    setQuery(seed);
    setActiveIndex(Math.max(selectedIndex, 0));
    setMode(isWide ? "listbox" : "sheet");
  }

  function close(): void {
    shouldRefocusRef.current = mode === "sheet";
    setMode(null);
  }

  function pick(option: ComboboxOption): void {
    onChange(option.value);
    close();
  }

  function changeQuery(next: string): void {
    setQuery(next);
    setActiveIndex(0);
  }

  // Keys while a list is open: on the trigger in the listbox, on the
  // search in the sheet.
  function handleOpenKey(event: KeyboardEvent<HTMLInputElement>): void {
    const lastIndex = matches.length - 1;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex(Math.min(activeIndex + 1, lastIndex));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex(Math.max(activeIndex - 1, 0));
    } else if (event.key === "Enter" && activeOption) {
      event.preventDefault();
      pick(activeOption);
    } else if (event.key === "Escape") {
      // Marks the key handled, so no overlay closes with it, and a search
      // field doesn't spend the press clearing itself.
      event.preventDefault();
      close();
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (mode === "listbox") {
      handleOpenKey(event);
    } else if (mode === null) {
      if (event.key === "ArrowDown" || event.key === "Enter") {
        event.preventDefault();
        open();
      } else if (isPrintable(event)) {
        // Typed into the query instead, which starts empty.
        event.preventDefault();
        open(event.key);
      }
    }
  }

  function handleTriggerChange(text: string): void {
    if (mode === null) {
      open(text);
      return;
    }
    changeQuery(text);
  }

  // On a phone the trigger never takes focus from a press, so the
  // keyboard doesn't flash up under the sheet; the click opens it. The
  // sheet can't open on the press itself: a tap's click would land on
  // its scrim and close it.
  function handleTriggerMouseDown(event: MouseEvent<HTMLInputElement>): void {
    const trigger = triggerRef.current;
    if (mode === null && trigger && !isKitWide(trigger)) event.preventDefault();
  }

  function handleTriggerClick(): void {
    if (mode === null) open();
  }

  // The kit may have crossed the 672px split since the last open.
  function handleTriggerFocus(): void {
    const trigger = triggerRef.current;
    if (trigger) setTriggerInputMode(trigger, isKitWide(trigger));
  }

  function handleTriggerBlur(): void {
    if (mode === "listbox") close();
  }

  // Runs after BottomSheet has focused its panel, so the search wins.
  useEffect(() => {
    if (mode === "sheet") {
      searchRef.current?.focus({ preventScroll: true });
    } else if (mode === null && shouldRefocusRef.current) {
      shouldRefocusRef.current = false;
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [mode]);

  // The sheet keeps the height it opened at while matches narrow, so the
  // search being typed in never jumps down; min-h-72 stays the floor.
  // Set on the node, measured before paint.
  useLayoutEffect(() => {
    const list = sheetListRef.current;
    if (mode !== "sheet" || !list) return;
    list.style.minHeight = "";
    list.style.minHeight = `${getSheetListHeight(list)}px`;
  }, [mode]);

  // A new query starts the sheet's rows from the top, so a short result
  // (or the no-match row) never sits above a list scrolled far down.
  useLayoutEffect(() => {
    const scroller = sheetListRef.current?.parentElement;
    if (mode === "sheet") scroller?.scrollTo({ top: 0 });
  }, [mode, query]);

  const activeId = activeOption ? getOptionId(activeOption) : null;
  useEffect(() => {
    const list = mode === "sheet" ? sheetListRef.current : listRef.current;
    const row = activeId ? document.getElementById(activeId) : null;
    if (!mode || !list || !row) return;

    // The listbox scrolls itself; the sheet scrolls its body, under the
    // pinned search just before the list.
    const isSheet = mode === "sheet";
    const scroller = isSheet ? list.parentElement : list;
    const cover = isSheet ? list.previousElementSibling : null;
    const coveredTop = cover?.getBoundingClientRect().bottom ?? 0;
    if (scroller) revealRow(scroller, row, coveredTop);
  }, [mode, activeId]);

  return {
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
    handleSearchKeyDown: handleOpenKey,
  };
}
