// Overlay motion: the keyframe sets every overlay enters with, and the
// timing for both directions. usePresence runs them with the Web
// Animations API after the element mounts. CSS keyframe animations on
// these layers rendered no motion in Chromium (the box snapped to its end
// position), most likely because they start during the container-query
// style pass; animating after commit works. Keyframes can differ for
// phone and wide layouts. Exits play the same frames reversed.

// Same breakpoint as @2xl, where overlays change shape.
const WIDE_KIT_WIDTH = 672;
export const ENTER_MS = 260;
export const ENTER_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";
// In-flow lists (the Combobox) keep the kit-rise pace from kit.css.
export const LIST_ENTER_MS = 220;
// Exits are faster than enters and ease in, so they never hold up the
// next action.
export const EXIT_MS = 160;
export const EXIT_EASING = "cubic-bezier(0.4, 0, 1, 1)";

export type EnterKeyframes = (isWide: boolean) => Keyframe[];

// Measured on the kit root, so a phone frame inside a wide window counts
// as a phone.
export function isKitWide(element: HTMLElement): boolean {
  const root = element.closest("[data-kit]");
  return (root?.clientWidth ?? window.innerWidth) >= WIDE_KIT_WIDTH;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

// The scrim under modal overlays: enters with the CSS kit-fade, leaves
// with these frames reversed.
export const FADE: EnterKeyframes = () => [{ opacity: 0 }, { opacity: 1 }];
