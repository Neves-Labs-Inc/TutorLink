import type { Theme } from "@/components/kit/tokens";
import type { ThemePreference } from "@/lib/theme/theme";
import { selectTheme, useThemeStore } from "@/stores/theme-store";

type UseTheme = {
  preference: ThemePreference;
  // Always "light" or "dark": what KitRoot takes.
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
};

export function useTheme(): UseTheme {
  const preference = useThemeStore((state) => state.preference);
  const theme = useThemeStore(selectTheme);
  const setPreference = useThemeStore((state) => state.setPreference);
  return { preference, theme, setPreference };
}
