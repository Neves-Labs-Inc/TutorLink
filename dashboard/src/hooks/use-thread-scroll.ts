// Keeps the newest message in view: on open, and when a message arrives
// while the reader is at the bottom. Loading older messages keeps the
// reading position. All jumps are instant (no smooth scroll).
import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { Message } from "@/lib/queries/conversations";
import { threadScrollDecision } from "@/lib/thread-scroll/threadScrollDecision";
import type { ThreadSnapshot } from "@/lib/thread-scroll/threadScrollDecision";

const NEAR_BOTTOM_PX = 100;
const SCROLLING = new Set(["auto", "scroll"]);
const EMPTY: ThreadSnapshot = { firstId: null, lastId: null, length: 0 };

function getSnapshot(messages: Message[]): ThreadSnapshot {
  return {
    firstId: messages[0]?.id ?? null,
    lastId: messages.at(-1)?.id ?? null,
    length: messages.length,
  };
}

function getDistanceFromBottom(scroller: HTMLElement): number {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
}

// The thread scrolls inside its pane, or inside the kit DetailOverlay's
// own body, so the scroller is found rather than owned.
function findScroller(element: HTMLElement | null): HTMLElement | null {
  let scroller = element?.parentElement ?? null;
  while (scroller && !SCROLLING.has(getComputedStyle(scroller).overflowY)) {
    scroller = scroller.parentElement;
  }
  return scroller;
}

export function useThreadScroll(
  anchorRef: RefObject<HTMLElement | null>,
  messages: Message[],
  lastSentId: string | null,
): void {
  // Measured after each render and scroll, so it is the distance before
  // the next content lands.
  const distanceRef = useRef(0);
  const snapshotRef = useRef<ThreadSnapshot>(EMPTY);

  useLayoutEffect(() => {
    const scroller = findScroller(anchorRef.current);
    if (!scroller) return;

    const handleScroll = (): void => {
      distanceRef.current = getDistanceFromBottom(scroller);
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", handleScroll);
  }, [anchorRef]);

  useLayoutEffect(() => {
    const scroller = findScroller(anchorRef.current);
    if (!scroller) return;

    const next = getSnapshot(messages);
    const savedDistance = distanceRef.current;
    const decision = threadScrollDecision({
      previous: snapshotRef.current,
      next,
      wasNearBottom: savedDistance <= NEAR_BOTTOM_PX,
      lastIsOwnSend: next.lastId !== null && next.lastId === lastSentId,
    });
    if (decision === "jump" || decision === "follow") {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "instant" });
    } else if (decision === "preserve") {
      scroller.scrollTo({
        top: scroller.scrollHeight - scroller.clientHeight - savedDistance,
        behavior: "instant",
      });
    }
    snapshotRef.current = next;
    distanceRef.current = getDistanceFromBottom(scroller);
  }, [anchorRef, messages, lastSentId]);
}
