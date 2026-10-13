// Faithful pastel tokens (TutorLink#187), the one source for colour.
// Components read them as CSS variables: `bg-(--tl-surface)`.
import type { CSSProperties } from "react";

export type Theme = "light" | "dark";

export const LIGHT = {
  canvas: "#F4F9FB",
  surface: "#FFFFFF",
  "surface-sunk": "#EEF5F8",
  tint: "#E8F4F8",
  "tint-strong": "#D6EDF5",
  hero: "#ADD8E6",
  primary: "#1F6F8B",
  "primary-hover": "#175A72",
  "on-primary": "#FFFFFF",
  link: "#175A72",
  "primary-ink": "#0F4C61",
  ink: "#14212E",
  "ink-soft": "#334155",
  muted: "#5A6B7B",
  border: "#DCE8EF",
  // Input, checkbox and switch outlines: 3:1 against surface (WCAG 1.4.11).
  "field-border": "#8397A6",
  "card-border": "#E6EFF4",
  focus: "#1F6F8B",
  "on-hero": "#0F4C61",
  pink: "#FFC0CB",
  "pink-tint": "#FFE5EC",
  "pink-ink": "#8A2846",
  yellow: "#FFFACD",
  "yellow-tint": "#FFFBE0",
  "yellow-ink": "#6B5300",
  green: "#B8F0B8",
  "green-tint": "#E8F8E8",
  "green-ink": "#1E6B34",
  success: "#1E7A43",
  "success-tint": "#E3F6E8",
  warning: "#8A5A00",
  "warning-tint": "#FFF2CC",
  danger: "#B42335",
  "danger-tint": "#FFE5EA",
  "danger-hover": "#951B2B",
  "on-danger": "#FFFFFF",
  info: "#175A72",
  "info-tint": "#E1F1F7",
  neutral: "#4B5B6A",
  "neutral-tint": "#EDF2F5",
  inverse: "#14212E",
  "on-inverse": "#F4F9FB",
  "inverse-link": "#ADD8E6",
  skeleton: "#E3EDF2",
  glow: "rgba(173, 216, 230, 0.45)",
  "glow-pink": "rgba(255, 192, 203, 0.22)",
  scrim: "rgba(20, 33, 46, 0.32)",
  "shadow-soft":
    "0 1px 2px rgba(20, 33, 46, 0.04), 0 10px 30px -12px rgba(31, 111, 139, 0.18)",
  "shadow-raised":
    "0 2px 6px rgba(20, 33, 46, 0.05), 0 28px 56px -20px rgba(31, 111, 139, 0.34)",
};

export type TokenName = keyof typeof LIGHT;

export const DARK: Record<TokenName, string> = {
  canvas: "#0E1A26",
  surface: "#152433",
  "surface-sunk": "#11202E",
  tint: "#1B2E40",
  "tint-strong": "#233D50",
  hero: "#ADD8E6",
  primary: "#ADD8E6",
  "primary-hover": "#C6E6F0",
  "on-primary": "#0B1724",
  link: "#ADD8E6",
  "primary-ink": "#CDEAF3",
  ink: "#E6F0F5",
  "ink-soft": "#C4D3DD",
  muted: "#9DB3C2",
  border: "#26394C",
  "field-border": "#5F7A90",
  "card-border": "#22364A",
  focus: "#ADD8E6",
  "on-hero": "#0F4C61",
  pink: "#FFC0CB",
  "pink-tint": "#3A2633",
  "pink-ink": "#FFC0CB",
  yellow: "#FFFACD",
  "yellow-tint": "#33301E",
  "yellow-ink": "#FFF3A6",
  green: "#B8F0B8",
  "green-tint": "#17302A",
  "green-ink": "#B8F0B8",
  success: "#8FE3A8",
  "success-tint": "#17302A",
  warning: "#FFE08A",
  "warning-tint": "#33301E",
  danger: "#FF9FAE",
  "danger-tint": "#3A2230",
  "danger-hover": "#FFB8C3",
  "on-danger": "#2A0B14",
  info: "#ADD8E6",
  "info-tint": "#1D3647",
  neutral: "#B7C5D0",
  "neutral-tint": "#243442",
  inverse: "#E6F0F5",
  "on-inverse": "#0E1A26",
  "inverse-link": "#175A72",
  skeleton: "#1F3242",
  glow: "rgba(173, 216, 230, 0.10)",
  "glow-pink": "rgba(255, 192, 203, 0.05)",
  scrim: "rgba(4, 10, 16, 0.6)",
  "shadow-soft":
    "0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 12px 32px -14px rgba(0, 0, 0, 0.55)",
  "shadow-raised":
    "0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 30px 60px -20px rgba(0, 0, 0, 0.7)",
};

export const TOKENS: Record<Theme, Record<TokenName, string>> = {
  light: LIGHT,
  dark: DARK,
};

// The brand hue (195deg) as a ramp; 200 is the site's lightBlue.
export const PRIMARY_RAMP = [
  ["50", "#E8F4F8"],
  ["100", "#D6EDF5"],
  ["200", "#ADD8E6"],
  ["300", "#7FBFD4"],
  ["400", "#559FB9"],
  ["500", "#3E8FAC"],
  ["600", "#1F6F8B"],
  ["700", "#175A72"],
  ["800", "#0F4C61"],
  ["900", "#0A3646"],
] as const;

export function getTokenStyle(theme: Theme): CSSProperties {
  const entries = Object.entries(TOKENS[theme]).map(([name, value]) => [
    `--tl-${name}`,
    value,
  ]);
  // CSSProperties has no index for custom properties; every key is --tl-*.
  return Object.fromEntries(entries) as CSSProperties;
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// Shared class sets for surfaces the components below don't own.
export const CARD =
  "rounded-[20px] border border-(--tl-card-border) bg-(--tl-surface) kit-shadow-soft";
export const EYEBROW =
  "text-[12px] font-semibold tracking-[0.14em] text-(--tl-muted) uppercase";
export const TITLE =
  "kit-display text-[34px] leading-[42px] font-light tracking-[-0.01em] @5xl:text-[44px] @5xl:leading-[52px]";
export const HEADING = "kit-display text-[20px] leading-7 font-bold";
export const CARD_TITLE = "kit-display text-[17px] leading-6 font-bold";

export type Tone =
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "neutral"
  | "primary"
  | "pink"
  | "yellow"
  | "green";

export const TONE_CLASSES: Record<Tone, string> = {
  info: "bg-(--tl-info-tint) text-(--tl-info)",
  success: "bg-(--tl-success-tint) text-(--tl-success)",
  warning: "bg-(--tl-warning-tint) text-(--tl-warning)",
  danger: "bg-(--tl-danger-tint) text-(--tl-danger)",
  neutral: "bg-(--tl-neutral-tint) text-(--tl-neutral)",
  primary: "bg-(--tl-tint-strong) text-(--tl-primary-ink)",
  pink: "bg-(--tl-pink-tint) text-(--tl-pink-ink)",
  yellow: "bg-(--tl-yellow-tint) text-(--tl-yellow-ink)",
  green: "bg-(--tl-green-tint) text-(--tl-green-ink)",
};
