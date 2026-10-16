import type { SettingsApi } from "@/pages/prototype/settings/hooks/use-settings";

export type BoundField = {
  value: string;
  error: string | undefined;
  isChanged: boolean;
  onChange: (value: string) => void;
};

// The four props every setting field takes, read from the page state.
export function bindField(settings: SettingsApi, key: string): BoundField {
  const value = settings.valueOf(key);
  return {
    value,
    error: settings.errorOf(key),
    isChanged: value !== settings.savedValueOf(key),
    onChange: (next) => settings.setValue(key, next),
  };
}
