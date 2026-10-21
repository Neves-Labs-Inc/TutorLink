// The "?" toggletip beside a label or rule title: a 44px round button
// that opens a short plain-text explanation under it. Click or tap
// toggles it; Escape, a pointer down outside, or focus moving elsewhere
// closes it, and focus stays on the button. No hover opening, so it
// behaves the same on touch and mouse. The bubble is in flow (not
// portaled) and lands in an always-mounted polite live region, so
// screen readers read it out when it opens.
import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, KeyboardEvent, ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { LIST_ENTER_MS, RISE } from "@/components/kit/overlays/use-enter-animation";
import { usePresence } from "@/components/kit/overlays/use-presence";

type InfoTipProps = {
  // The button's accessible name: "About Session length".
  label: string;
  // Plain text, about three short sentences at most; no links.
  children: ReactNode;
};

const BUBBLE_MAX_WIDTH = 280;
const KIT_EDGE_INSET = 16;

// Where the bubble's left edge sits, relative to the button: under it
// when it fits, right-aligned to it when that would pass the kit's
// right edge, and pulled in from the kit's left edge as a last resort
// on very narrow screens, so it never causes horizontal scroll.
function getBubbleLeft(trigger: HTMLElement): number {
  const root = trigger.closest("[data-kit]");
  if (!root) return 0;

  const rootRect = root.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const width = Math.min(BUBBLE_MAX_WIDTH, rootRect.width - 2 * KIT_EDGE_INSET);
  let left = 0;
  if (triggerRect.left + width > rootRect.right - KIT_EDGE_INSET) {
    left = triggerRect.width - width;
  }
  const leftLimit = rootRect.left + KIT_EDGE_INSET - triggerRect.left;
  return Math.max(left, leftLimit);
}

export function InfoTip({ label, children }: InfoTipProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  // Set a frame after opening, so the text arrives as a change to the
  // live region and gets announced.
  const [isBubbleShown, setIsBubbleShown] = useState(false);
  const [bubbleLeft, setBubbleLeft] = useState(0);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const bubbleId = useId();
  const isBubblePresent = usePresence(isBubbleShown, bubbleRef, RISE, {
    enterMs: LIST_ENTER_MS,
  });
  // Playing its exit: out of reach for clicks and assistive tech.
  const isBubbleLeaving = isBubblePresent && !isBubbleShown;

  function close(): void {
    setIsOpen(false);
    setIsBubbleShown(false);
  }

  function handleClick(): void {
    if (isOpen) {
      close();
      return;
    }
    if (buttonRef.current) setBubbleLeft(getBubbleLeft(buttonRef.current));
    setIsOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "Escape" || !isOpen) return;
    // Keeps an enclosing dialog or sheet open.
    event.stopPropagation();
    close();
  }

  // Only a focus move to something else closes it; outside clicks are
  // the pointerdown listener's job. Focus landing on an ancestor (a
  // dialog or sheet panel is focusable) isn't a move away.
  function handleBlur(event: FocusEvent<HTMLButtonElement>): void {
    const next = event.relatedTarget;
    if (!isOpen || !(next instanceof Node)) return;
    const wrapper = wrapperRef.current;
    if (wrapper && (next.contains(wrapper) || wrapper.contains(next))) return;
    close();
  }

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => setIsBubbleShown(true));

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen]);

  const bubbleStyle: CSSProperties = { left: bubbleLeft };

  return (
    // -my-3 lets the 44px target sit in a label row without growing it.
    <span ref={wrapperRef} className="relative -my-3 inline-flex shrink-0 align-middle">
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={isBubblePresent ? bubbleId : undefined}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className={cn(
          "inline-flex size-11 cursor-pointer items-center justify-center rounded-full transition-colors duration-150 active:bg-(--tl-tint-strong)",
          isOpen
            ? "bg-(--tl-tint-strong) text-(--tl-primary-ink)"
            : "text-(--tl-muted) hover:bg-(--tl-tint) hover:text-(--tl-link)",
        )}
      >
        <CircleHelp aria-hidden className="size-[18px]" />
      </button>
      <span role="status" aria-live="polite">
        {isBubblePresent && (
          <span
            ref={bubbleRef}
            id={bubbleId}
            inert={isBubbleLeaving}
            aria-hidden={isBubbleLeaving || undefined}
            style={bubbleStyle}
            // Keeps focus on the button, so Escape still closes it.
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              "kit-shadow-raised absolute top-[calc(100%+4px)] z-40 block w-[min(280px,calc(100cqw-32px))] rounded-[20px] border border-(--tl-card-border) bg-(--tl-surface) px-4 py-3 text-left text-[14px] leading-5 font-normal tracking-normal whitespace-normal normal-case text-(--tl-ink-soft)",
              isBubbleLeaving && "pointer-events-none",
            )}
          >
            {children}
          </span>
        )}
      </span>
    </span>
  );
}
