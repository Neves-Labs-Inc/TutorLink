import type { Theme } from "@/components/kit/tokens";

export type ThemePreference = Theme | "system";

// Shared with the inline pre-paint script in index.html; keep both in sync.
export const THEME_STORAGE_KEY = "tutorlink.theme";
export const DEFAULT_PREFERENCE: ThemePreference = "system";

const PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];
const OS_DARK_QUERY = "(prefers-color-scheme: dark)";
const SWITCHING_ATTRIBUTE = "data-theme-switching";

export function parsePreference(raw: string | null): ThemePreference {
  const match = PREFERENCES.find((preference) => preference === raw);
  return match ?? DEFAULT_PREFERENCE;
}

export function resolveTheme(
  preference: ThemePreference,
  isOsDark: boolean,
): Theme {
  if (preference !== "system") return preference;

  return isOsDark ? "dark" : "light";
}

export function readStoredPreference(): ThemePreference {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode, policy): translated to "no choice".
    raw = null;
  }
  return parsePreference(raw);
}

export function storePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage blocked: the choice still applies for this session.
    return;
  }
}

export function getOsDarkQuery(): MediaQueryList {
  return window.matchMedia(OS_DARK_QUERY);
}

// Sets the theme on <html> with transitions off for that frame, so every
// surface flips at once instead of fading at its own pace.
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute(SWITCHING_ATTRIBUTE, "");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  // Reading layout flushes styles while transitions are still suppressed.
  void root.offsetHeight;
  requestAnimationFrame(() => root.removeAttribute(SWITCHING_ATTRIBUTE));
}
