// The page's state: the saved SettingsPage, the unsaved draft, field
// errors, and a fake PATCH /api/settings. Template subjects and bodies
// save on their own from the editor (saveTemplate).
import { useState } from "react";
import type {
  SettingsPage,
  SettingWrite,
} from "@/pages/prototype/settings/types/api";
import { checkValue } from "@/pages/prototype/settings/lib/rules";
import { EDITOR_KEYS, SECTIONS } from "@/pages/prototype/settings/lib/sections";
import type { SectionId } from "@/pages/prototype/settings/lib/sections";

export type SaveState = "idle" | "saving" | "failed";

const SAVE_MS = 900;
const RETENTION_KEY = "chat_retention_days";

export type SettingsApi = {
  page: SettingsPage;
  valueOf: (key: string) => string;
  savedValueOf: (key: string) => string;
  setValue: (key: string, value: string) => void;
  errorOf: (key: string) => string | undefined;
  updates: SettingWrite[];
  hasErrors: boolean;
  changedIn: (section: SectionId) => number;
  saveState: SaveState;
  // True when the save would shorten chat history, so it needs a confirm.
  isRetentionShortened: boolean;
  save: () => void;
  discard: () => void;
  saveTemplate: (writes: SettingWrite[]) => void;
};

type UseSettingsOptions = {
  initialPage: SettingsPage;
  initialDraft?: Record<string, string>;
  shouldSaveFail: boolean;
  onSaved: () => void;
};

function readValue(page: SettingsPage, key: string): string {
  return page.items.find((item) => item.key === key)?.value ?? "";
}

function applyWrites(page: SettingsPage, writes: SettingWrite[]): SettingsPage {
  return {
    ...page,
    items: page.items.map((item) => {
      const write = writes.find((entry) => entry.key === item.key);
      return write ? { ...item, value: write.value } : item;
    }),
  };
}

export function useSettings({
  initialPage,
  initialDraft = {},
  shouldSaveFail,
  onSaved,
}: UseSettingsOptions): SettingsApi {
  const [page, setPage] = useState(initialPage);
  const [draft, setDraft] = useState<Record<string, string>>(initialDraft);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [failsLeft, setFailsLeft] = useState(shouldSaveFail ? 1 : 0);

  const updates: SettingWrite[] = Object.entries(draft)
    .filter(([key]) => !EDITOR_KEYS.includes(key))
    .filter(([key, value]) => value !== readValue(page, key))
    .map(([key, value]) => ({ key, value }));
  const errors = Object.fromEntries(
    updates.flatMap(({ key, value }) => {
      const error = checkValue(key, value);
      return error ? [[key, error]] : [];
    }),
  ) as Record<string, string>;

  const retentionDraft = draft[RETENTION_KEY];
  const savedRetention = Number(readValue(page, RETENTION_KEY));
  // 0 is "keep forever", so going from 0 to anything also shortens it.
  const isRetentionShortened =
    retentionDraft !== undefined &&
    retentionDraft !== String(savedRetention) &&
    (savedRetention === 0 || Number(retentionDraft) < savedRetention) &&
    Number(retentionDraft) !== 0;

  function setValue(key: string, value: string): void {
    setDraft((current) => ({ ...current, [key]: value }));
    if (saveState === "failed") setSaveState("idle");
  }

  function save(): void {
    if (updates.length === 0 || Object.keys(errors).length > 0) return;
    setSaveState("saving");
    window.setTimeout(() => {
      if (failsLeft > 0) {
        setFailsLeft(failsLeft - 1);
        setSaveState("failed");
        return;
      }
      setPage((current) => applyWrites(current, updates));
      setDraft({});
      setSaveState("idle");
      onSaved();
    }, SAVE_MS);
  }

  function discard(): void {
    setDraft({});
    setSaveState("idle");
  }

  function changedIn(section: SectionId): number {
    const keys = SECTIONS.find((entry) => entry.id === section)?.keys ?? [];
    return updates.filter((update) => keys.includes(update.key)).length;
  }

  return {
    page,
    valueOf: (key) => draft[key] ?? readValue(page, key),
    savedValueOf: (key) => readValue(page, key),
    setValue,
    errorOf: (key) => errors[key],
    updates,
    hasErrors: Object.keys(errors).length > 0,
    changedIn,
    saveState,
    isRetentionShortened,
    save,
    discard,
    saveTemplate: (writes) => setPage((current) => applyWrites(current, writes)),
  };
}
