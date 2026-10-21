import { create } from "zustand";
import type { Theme } from "@/components/kit/tokens";
import {
  applyTheme,
  getOsDarkQuery,
  readStoredPreference,
  resolveTheme,
  storePreference,
} from "@/lib/theme/theme";
import type { ThemePreference } from "@/lib/theme/theme";

type ThemeState = {
  preference: ThemePreference;
  isOsDark: boolean;
  setPreference: (preference: ThemePreference) => void;
  setOsDark: (isOsDark: boolean) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
  preference: readStoredPreference(),
  isOsDark: getOsDarkQuery().matches,
  setPreference: (preference) => {
    storePreference(preference);
    set({ preference });
  },
  setOsDark: (isOsDark) => set({ isOsDark }),
}));

export function selectTheme(state: ThemeState): Theme {
  return resolveTheme(state.preference, state.isOsDark);
}

// Keeps <html> on the resolved theme for the app's lifetime: on a choice,
// and on an OS change while the choice is System. Call once at startup.
export function startThemeSync(): void {
  applyTheme(selectTheme(useThemeStore.getState()));
  getOsDarkQuery().addEventListener("change", (event) => {
    useThemeStore.getState().setOsDark(event.matches);
  });
  useThemeStore.subscribe((state, previous) => {
    const theme = selectTheme(state);
    if (theme !== selectTheme(previous)) applyTheme(theme);
  });
}
