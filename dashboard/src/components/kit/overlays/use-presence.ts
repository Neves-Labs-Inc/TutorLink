// Keeps an overlay mounted while it animates out. On open the panel
// plays its enter frames; on close it plays the same frames reversed
// (faster, easing in), the scrim fades out alongside, and only then does
// the caller unmount it. Closing mid-enter and reopening mid-exit both
// start from wherever the element is, never from a snapped end state.
// With reduced motion, open and close are instant.
import { useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  ENTER_EASING,
  ENTER_MS,
  EXIT_EASING,
  EXIT_MS,
  FADE,
  isKitWide,
  prefersReducedMotion,
} from "@/components/kit/overlays/use-enter-animation";
import type { EnterKeyframes } from "@/components/kit/overlays/use-enter-animation";

// Holds the closed frame until the caller unmounts, so the open state
// never flashes back for a frame in between.
const EXIT_TIMING: KeyframeAnimationOptions = {
  duration: EXIT_MS,
  easing: EXIT_EASING,
  fill: "forwards",
};

// The element's current value for each property the frame animates.
function readFrame(element: HTMLElement, frame: Keyframe): Keyframe {
  const computed = window.getComputedStyle(element);
  const properties = Object.keys(frame).filter(
    (key) => key !== "offset" && key !== "easing" && key !== "composite",
  );
  return Object.fromEntries(
    properties.map((property) => [
      property,
      computed.getPropertyValue(property),
    ]),
  );
}

// Plays frames on the element, starting from where an interrupted
// animation left it rather than from the first frame. CSS animations
// count too: the scrim fades in with kit-fade.
function playFrom(
  element: HTMLElement,
  previous: Animation | null,
  frames: Keyframe[],
  timing: KeyframeAnimationOptions,
): Animation {
  const isInterrupting = element
    .getAnimations()
    .some((animation) => animation.playState === "running");
  const start = isInterrupting ? readFrame(element, frames[0]) : frames[0];
  previous?.cancel();
  return element.animate([start, ...frames.slice(1)], timing);
}

type RunningAnimations = { panel: Animation | null; scrim: Animation | null };

function stopAll(running: RunningAnimations): void {
  running.panel?.cancel();
  running.scrim?.cancel();
  running.panel = null;
  running.scrim = null;
}

type PresenceOptions = {
  // Fades out with the panel, and back in on a reopen mid-exit.
  scrimRef?: RefObject<HTMLElement | null>;
  enterMs?: number;
};

// Returns whether the overlay should be mounted: while open, and while
// its exit plays.
export function usePresence(
  isOpen: boolean,
  panelRef: RefObject<HTMLElement | null>,
  keyframes: EnterKeyframes,
  { scrimRef, enterMs = ENTER_MS }: PresenceOptions = {},
): boolean {
  const [isExiting, setIsExiting] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  const runningRef = useRef<RunningAnimations>({ panel: null, scrim: null });

  // Checked at each close, so a mid-session change applies.
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    setIsExiting(!isOpen && !prefersReducedMotion());
  }

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const scrim = scrimRef?.current ?? null;
    // Mutated in place: the animations belong to the mounted nodes, not
    // to any one render.
    const running = runningRef.current;
    const enterTiming = { duration: enterMs, easing: ENTER_EASING };
    if (isOpen) {
      if (!panel) return;
      if (prefersReducedMotion()) {
        stopAll(running);
        return;
      }
      const frames = keyframes(isKitWide(panel));
      running.panel = playFrom(panel, running.panel, frames, enterTiming);
      // A fresh scrim fades in with CSS; only a reopen mid-exit needs
      // to bring it back from where it is.
      if (scrim && running.scrim) {
        const fadeIn = FADE(true);
        running.scrim = playFrom(scrim, running.scrim, fadeIn, enterTiming);
      }
      return;
    }
    // Closed with reduced motion, or the exit has played: unmounted, so
    // the next open mounts fresh nodes with nothing to interrupt.
    if (!isExiting) {
      stopAll(running);
      return;
    }

    const exit = panel
      ? playFrom(
          panel,
          running.panel,
          [...keyframes(isKitWide(panel))].reverse(),
          EXIT_TIMING,
        )
      : null;
    running.panel = exit;
    if (scrim) {
      const fadeOut = [...FADE(true)].reverse();
      running.scrim = playFrom(scrim, running.scrim, fadeOut, EXIT_TIMING);
    }
    (exit?.finished ?? Promise.resolve()).then(
      () => {
        // A reopen since has replaced this exit; it owns the element now.
        if (runningRef.current.panel !== exit) return;
        // Keep the finished exits referenced: their forwards fill holds
        // the panel off-screen, and a reopen landing before the unmount
        // commits must cancel them. The unmount render drops them.
        setIsExiting(false);
      },
      // Cancelled by a reopen or an unmount: nothing left to do.
      () => undefined,
    );
    // Runs once per open or close; the keyframe builder is a static
    // function picked by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isExiting, panelRef, scrimRef, enterMs]);

  return isOpen || isExiting;
}

// What an overlay shows: the live value while open, and the last open
// value while it leaves, so callers that clear their data on close
// (isOpen={item !== null}) still slide out intact. Compared field by
// field, since callers pass a fresh object every render.
export function useHeldWhileClosing<T extends Record<string, unknown>>(
  value: T,
  isOpen: boolean,
): T {
  const [held, setHeld] = useState(value);
  const isChanged = Object.keys(value).some(
    (key) => !Object.is(value[key], held[key]),
  );
  if (isOpen && isChanged) setHeld(value);
  return isOpen ? value : held;
}
