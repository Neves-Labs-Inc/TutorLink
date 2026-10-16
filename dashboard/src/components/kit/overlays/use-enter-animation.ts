// Entry motion for overlays, run with the Web Animations API after the
// element mounts. CSS keyframe animations on these layers rendered no
// motion in Chromium (the box snapped to its end position), most likely
// because they start during the container-query style pass; animating
// after commit works. Keyframes can differ for phone and wide layouts.
import { useEffect } from "react";
import type { RefObject } from "react";

// Same breakpoint as @2xl, where overlays change shape.
const WIDE_KIT_WIDTH = 672;
const ENTER_MS = 260;
const ENTER_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export type EnterKeyframes = (isWide: boolean) => Keyframe[];

export function useEnterAnimation(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  getKeyframes: EnterKeyframes,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!isOpen || !element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = element.closest("[data-kit]");
    const isWide = (root?.clientWidth ?? window.innerWidth) >= WIDE_KIT_WIDTH;
    element.animate(getKeyframes(isWide), {
      duration: ENTER_MS,
      easing: ENTER_EASING,
    });
    // Runs once per open; the keyframe builder is a static function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, ref]);
}

// Shared keyframe sets.
export const PUSH_FROM_RIGHT: EnterKeyframes = (isWide) =>
  isWide
    ? [
        { opacity: 0, transform: "translateX(32px)" },
        { opacity: 1, transform: "translateX(0)" },
      ]
    : [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }];

export const RISE_AS_SHEET: EnterKeyframes = (isWide) =>
  isWide
    ? [
        { opacity: 0, transform: "translateX(32px)" },
        { opacity: 1, transform: "translateX(0)" },
      ]
    : [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }];

export const SHEET_OR_POP: EnterKeyframes = (isWide) =>
  isWide
    ? [
        { opacity: 0, transform: "scale(0.96)" },
        { opacity: 1, transform: "scale(1)" },
      ]
    : [{ transform: "translateY(100%)" }, { transform: "translateY(0)" }];

export const POP: EnterKeyframes = () => [
  { opacity: 0, transform: "scale(0.96)" },
  { opacity: 1, transform: "scale(1)" },
];

export const RISE: EnterKeyframes = () => [
  { opacity: 0, transform: "translateY(8px)" },
  { opacity: 1, transform: "translateY(0)" },
];
