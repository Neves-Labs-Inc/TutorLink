// State for the kit Select, an APG select-only combobox: open and close,
// the active option, keys, type-ahead, and the popover's placement.
// From 672px of kit width the list is a popover that keeps focus on the
// trigger (aria-activedescendant); narrower, it is a bottom sheet whose
// rows take real focus.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, MouseEvent, RefObject } from "react";
import type {
  SelectChange,
  SelectOpenMode,
  SelectOption,
} from "@/components/kit/types/select";

// Same breakpoint as MultiSelectFilter and the @2xl overlays.
const POPOVER_MIN_KIT_WIDTH = 672;
const POPOVER_GAP = 6;
const POPOVER_MIN_WIDTH = 200;
// A long option widens the list up to here, then truncates.
const POPOVER_MAX_WIDTH = 320;
const EDGE_INSET = 8;
const TYPE_AHEAD_MS = 500;
// Fallback release for a swallowed tap that never sends its click.
const TOUCH_RELEASE_MS = 1000;
// A click on one of these takes focus itself; anywhere else, focus goes
// back to the trigger.
// tabindex="-1" (an overlay's panel) doesn't count.
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type Bounds = { top: number; left: number; right: number; bottom: number };

// The box fixed elements pin to: KitRoot (contain: layout), or the window
// outside a kit.
function getKitBounds(trigger: HTMLElement): Bounds {
  const root = trigger.closest("[data-kit]");
  const viewport = {
    top: 0,
    left: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
  return root?.getBoundingClientRect() ?? viewport;
}

// How far the trigger's hit box overhangs what it draws: the inline
// variant pads its link text to 44px with negative margins.
function getOverhang(trigger: HTMLElement, side: "top" | "bottom"): number {
  const style = window.getComputedStyle(trigger);
  const margin = side === "top" ? style.marginTop : style.marginBottom;
  return Math.max(0, -parseFloat(margin));
}

// Below the trigger at its width (200px at least, wider up to 320px for a
// long option), flipped above when it doesn't fit below, and kept 8px
// inside the kit's edges. When neither side fits, the list shrinks to the
// side it's on and scrolls.
function placePopover(list: HTMLElement, trigger: HTMLElement): void {
  const bounds = getKitBounds(trigger);
  const box = trigger.getBoundingClientRect();
  const anchor = {
    top: box.top + getOverhang(trigger, "top"),
    bottom: box.bottom - getOverhang(trigger, "bottom"),
    left: box.left,
    width: box.width,
  };
  list.style.width = "max-content";
  // Rounded up: offsetWidth rounds down and would truncate the longest
  // label by a fraction of a pixel.
  const contentWidth = Math.min(
    Math.ceil(list.getBoundingClientRect().width),
    POPOVER_MAX_WIDTH,
  );
  // Never wider than the kit less its insets: an overflow would scroll
  // the kit sideways, and that scroll closes the popover.
  const width = Math.min(
    Math.max(anchor.width, POPOVER_MIN_WIDTH, contentWidth),
    bounds.right - bounds.left - 2 * EDGE_INSET,
  );
  list.style.width = `${width}px`;
  const height = list.offsetHeight;
  const spaceBelow = bounds.bottom - anchor.bottom;
  const spaceAbove = anchor.top - bounds.top;
  const isFlipped =
    spaceBelow < height + POPOVER_GAP + EDGE_INSET && spaceAbove > spaceBelow;
  const room = (isFlipped ? spaceAbove : spaceBelow) - POPOVER_GAP - EDGE_INSET;
  const fitted = Math.min(height, room);
  const top = isFlipped
    ? anchor.top - POPOVER_GAP - fitted
    : anchor.bottom + POPOVER_GAP;
  if (fitted < height) list.style.maxHeight = `${fitted}px`;
  const left = Math.max(
    bounds.left + EDGE_INSET,
    Math.min(anchor.left, bounds.right - EDGE_INSET - width),
  );
  list.style.top = `${top - bounds.top}px`;
  list.style.left = `${left - bounds.left}px`;
}

// Scrolls only the list's scroller, never its ancestors: an ancestor
// scroll would close the popover, or move the kit under a sheet.
function scrollIntoList(list: HTMLElement, option: HTMLElement): void {
  const listBox = list.getBoundingClientRect();
  const optionBox = option.getBoundingClientRect();
  if (optionBox.top < listBox.top) {
    list.scrollTop -= listBox.top - optionBox.top + POPOVER_GAP;
  } else if (optionBox.bottom > listBox.bottom) {
    list.scrollTop += optionBox.bottom - listBox.bottom + POPOVER_GAP;
  }
}

// Same rule as scrollIntoList; the browser clamps at either end.
function centerInList(list: HTMLElement, option: HTMLElement): void {
  const listBox = list.getBoundingClientRect();
  const optionBox = option.getBoundingClientRect();
  const optionCenter = optionBox.top + optionBox.height / 2;
  list.scrollTop += optionCenter - (listBox.top + listBox.height / 2);
}

// APG type-ahead: a repeated letter cycles through the options starting
// with it; a longer string matches from the active option on.
function findTypeAheadIndex(
  options: SelectOption[],
  buffer: string,
  activeIndex: number,
): number {
  const isRepeat = [...buffer].every((letter) => letter === buffer[0]);
  const needle = isRepeat ? buffer[0] : buffer;
  const start = isRepeat ? activeIndex + 1 : Math.max(activeIndex, 0);
  const indexes = options.map((_, index) => (start + index) % options.length);
  const match = indexes.find((index) =>
    options[index].label.toLowerCase().startsWith(needle),
  );
  return match ?? -1;
}

// Eats the rest of one press (mousedown, click), so nothing under the
// pointer acts on it and focus stays where it is. Every way a press ends
// releases it: the click itself, pointerup (no click follows a drag),
// pointercancel (a touch that turned into a scroll) and any key, so it
// can never eat a later click. It isn't tied to the Select, so
// unmounting can't strand it.
function swallowPress(pointerType: string): void {
  // A mouse clicks in the same task as pointerup; a tap's compatibility
  // mousedown and click arrive later, so touch and pen wait longer.
  const releaseDelay = pointerType === "mouse" ? 0 : TOUCH_RELEASE_MS;
  function block(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }
  function blockClick(event: Event): void {
    block(event);
    release();
  }
  function release(): void {
    document.removeEventListener("mousedown", block, true);
    document.removeEventListener("click", blockClick, true);
    document.removeEventListener("pointerup", scheduleRelease, true);
    document.removeEventListener("pointercancel", release, true);
    document.removeEventListener("keydown", release, true);
  }
  function scheduleRelease(): void {
    window.setTimeout(release, releaseDelay);
  }
  document.addEventListener("mousedown", block, true);
  document.addEventListener("click", blockClick, true);
  document.addEventListener("pointerup", scheduleRelease, true);
  document.addEventListener("pointercancel", release, true);
  document.addEventListener("keydown", release, true);
}

function isPrintable(event: KeyboardEvent): boolean {
  return (
    event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey
  );
}

type UseSelectArgs = {
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  name?: string;
  isDisabled: boolean;
  onChange?: (event: SelectChange) => void;
  onValueChange?: (value: string) => void;
};

type SelectState = {
  listId: string;
  getOptionId: (index: number) => string;
  triggerRef: RefObject<HTMLButtonElement | null>;
  listRef: RefObject<HTMLUListElement | null>;
  selectedValue: string;
  selectedIndex: number;
  activeIndex: number;
  openMode: SelectOpenMode;
  handleTriggerClick: () => void;
  handleTriggerKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  handleTriggerKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => void;
  handleTriggerBlur: (event: FocusEvent<HTMLButtonElement>) => void;
  handleListKeyDown: (event: KeyboardEvent<HTMLUListElement>) => void;
  handleListMouseDown: (event: MouseEvent<HTMLUListElement>) => void;
  setActiveIndex: (index: number) => void;
  pick: (index: number) => void;
  dismiss: () => void;
};

export function useSelect({
  options,
  value,
  defaultValue,
  name,
  isDisabled,
  onChange,
  onValueChange,
}: UseSelectArgs): SelectState {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeAheadRef = useRef({ buffer: "", at: 0 });
  // Whether closing hands focus back to the trigger (not after Tab).
  const shouldRefocusRef = useRef(false);
  // The mode the scroll effect last ran for, to tell an open from a move.
  const shownModeRef = useRef<SelectOpenMode>(null);
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const [openMode, setOpenMode] = useState<SelectOpenMode>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedValue = value ?? internalValue;
  const selectedIndex = options.findIndex(
    (option) => option.value === selectedValue,
  );
  const lastIndex = options.length - 1;

  function getOptionId(index: number): string {
    return `${listId}-${index}`;
  }

  function open(index: number): void {
    const trigger = triggerRef.current;
    if (isDisabled || !trigger) return;
    const bounds = getKitBounds(trigger);
    const kitWidth = bounds.right - bounds.left;
    setActiveIndex(Math.min(Math.max(index, 0), lastIndex));
    setOpenMode(kitWidth >= POPOVER_MIN_KIT_WIDTH ? "popover" : "sheet");
  }

  function close(shouldRefocus: boolean): void {
    shouldRefocusRef.current = shouldRefocus;
    typeAheadRef.current = { buffer: "", at: 0 };
    setOpenMode(null);
  }

  function pick(index: number, shouldRefocus = true): void {
    const option = options[index];
    if (option && option.value !== selectedValue) {
      if (value === undefined) setInternalValue(option.value);
      onChange?.({ target: { value: option.value, name } });
      onValueChange?.(option.value);
    }
    close(shouldRefocus);
  }

  function typeAhead(key: string, fromIndex: number): number {
    const now = Date.now();
    const previous = typeAheadRef.current;
    const isTyping = now - previous.at < TYPE_AHEAD_MS;
    const buffer = (isTyping ? previous.buffer : "") + key.toLowerCase();
    typeAheadRef.current = { buffer, at: now };
    return findTypeAheadIndex(options, buffer, fromIndex);
  }

  function isTypingAhead(): boolean {
    const { buffer, at } = typeAheadRef.current;
    return buffer !== "" && Date.now() - at < TYPE_AHEAD_MS;
  }

  function handleClosedKey(event: KeyboardEvent): void {
    const startIndex = Math.max(selectedIndex, 0);
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      open(startIndex);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      open(event.key === "Home" ? 0 : lastIndex);
    } else if (isPrintable(event)) {
      event.preventDefault();
      const match = typeAhead(event.key, selectedIndex);
      open(match === -1 ? startIndex : match);
    }
  }

  // Keys while the list is open. In the popover they arrive on the
  // trigger; in the sheet, on the focused row.
  function handleOpenKey(event: KeyboardEvent, isPopover: boolean): void {
    const { key } = event;
    if (key === " " && isTypingAhead()) {
      event.preventDefault();
      const match = typeAhead(key, activeIndex);
      if (match !== -1) setActiveIndex(match);
    } else if (key === "Enter" || key === " " || (key === "ArrowUp" && event.altKey)) {
      event.preventDefault();
      pick(activeIndex);
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      const step = key === "ArrowDown" ? 1 : -1;
      setActiveIndex(Math.min(Math.max(activeIndex + step, 0), lastIndex));
    } else if (key === "Home" || key === "End") {
      event.preventDefault();
      setActiveIndex(key === "Home" ? 0 : lastIndex);
    } else if (isPopover && key === "Tab") {
      // APG: Tab commits the highlighted option and moves on.
      pick(activeIndex, false);
    } else if (isPopover && key === "Escape") {
      // Marks the key handled, so the overlay below stays open.
      event.preventDefault();
      close(true);
    } else if (isPrintable(event)) {
      event.preventDefault();
      const match = typeAhead(key, activeIndex);
      if (match !== -1) setActiveIndex(match);
    }
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (openMode === "popover") {
      handleOpenKey(event, true);
    } else if (openMode === null) {
      handleClosedKey(event);
    }
  }

  // Space activates a button on keyup; the keydown already handled it.
  function handleTriggerKeyUp(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === " ") event.preventDefault();
  }

  function handleTriggerClick(): void {
    if (openMode) {
      close(true);
      return;
    }
    open(Math.max(selectedIndex, 0));
  }

  function handleTriggerBlur(event: FocusEvent<HTMLButtonElement>): void {
    if (openMode !== "popover") return;
    const next = event.relatedTarget;
    if (next instanceof Node && listRef.current?.contains(next)) return;
    close(false);
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    handleOpenKey(event, false);
  }

  // Keeps focus on the trigger when the popover (rows, scrollbar) is
  // pressed.
  function handleListMouseDown(event: MouseEvent<HTMLUListElement>): void {
    if (openMode === "popover") event.preventDefault();
  }

  // Placement is measured once per open, before paint: any scroll or
  // resize closes the popover, so it never needs to follow the trigger.
  useLayoutEffect(() => {
    const list = listRef.current;
    const trigger = triggerRef.current;
    if (openMode !== "popover" || !list || !trigger) return;
    placePopover(list, trigger);
  }, [openMode]);

  // Runs after BottomSheet has focused its panel, so the row wins.
  useEffect(() => {
    const option = document.getElementById(`${listId}-${activeIndex}`);
    const list = listRef.current;
    const isOpening = shownModeRef.current !== openMode;
    shownModeRef.current = openMode;
    if (!openMode || !option || !list) return;
    // preventScroll keeps the kit root still; only the list's own
    // scroller (the sheet body, or the popover itself) moves.
    if (openMode === "sheet") {
      option.focus({ preventScroll: true });
    }
    const scroller = openMode === "sheet" ? list.parentElement : list;
    if (!scroller) return;
    // A sheet opens with its pick centered; arrowing scrolls only as needed.
    if (openMode === "sheet" && isOpening) {
      centerInList(scroller, option);
    } else {
      scrollIntoList(scroller, option);
    }
  }, [openMode, activeIndex, listId]);

  useEffect(() => {
    if (openMode !== null || !shouldRefocusRef.current) return;
    shouldRefocusRef.current = false;
    triggerRef.current?.focus({ preventScroll: true });
  }, [openMode]);

  useEffect(() => {
    if (openMode !== "popover") return;

    const trigger = triggerRef.current;
    // Inside a Dialog or sheet, a press outside the list only closes the
    // list, like Escape: the overlay (scrim included) never gets it.
    const isInOverlay = Boolean(trigger?.closest("[data-kit-overlay]"));

    // The trigger's own label counts as the trigger: its click toggles.
    function isInside(target: EventTarget | null): boolean {
      if (!(target instanceof Node) || !trigger) return false;
      const labels = [...(trigger.labels ?? [])];
      return (
        trigger.contains(target) ||
        Boolean(listRef.current?.contains(target)) ||
        labels.some((label) => label.contains(target))
      );
    }

    function dismissOutside(): void {
      shouldRefocusRef.current = false;
      typeAheadRef.current = { buffer: "", at: 0 };
      setOpenMode(null);
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (isInside(target)) return;
      dismissOutside();
      if (isInOverlay) {
        swallowPress(event.pointerType);
        return;
      }
      const isFocusable =
        target instanceof Element && target.closest(FOCUSABLE) !== null;
      // After the press has moved focus (to nothing), take it back.
      if (!isFocusable) window.setTimeout(() => triggerRef.current?.focus({ preventScroll: true }));
    }

    // A press on the label would blur the trigger (closing the list)
    // before its click toggles it open again; keep focus put instead.
    function handleMouseDown(event: globalThis.MouseEvent): void {
      const target = event.target;
      const isOnLabel =
        target instanceof Node &&
        [...(trigger?.labels ?? [])].some((label) => label.contains(target));
      if (isOnLabel) event.preventDefault();
    }

    function handleScroll(event: Event): void {
      if (isInside(event.target)) return;
      dismissOutside();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("scroll", handleScroll, true);
    window.addEventListener("resize", dismissOutside);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", dismissOutside);
    };
  }, [openMode]);

  return {
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
    pick: (index) => pick(index),
    dismiss: () => close(true),
  };
}
