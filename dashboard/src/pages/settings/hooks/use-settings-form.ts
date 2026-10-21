// The Settings page's state: the saved GET /api/settings page, the
// unsaved draft, field errors, and the one PATCH that saves every changed
// plain key. Email subjects, bodies and colours save on their own (the
// email editor), and the time zone is never written from here.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SaveState } from "@/components/kit/components/save-bar";
import { errorDetail, errorStatus } from "@/lib/api";
import { settingQueries, updateSettings } from "@/lib/queries/settings";
import type { SettingsPage } from "@/lib/queries/settings";
import { checkSettingValue } from "@/lib/settings/setting-rules";
import {
  countChangesIn,
  findFieldError,
  getChangedUpdates,
  readSetting,
  wouldShortenRetention,
} from "@/lib/settings/settings-groups";
import type { GroupId } from "@/lib/settings/settings-groups";
import type { SettingUpdate } from "@/lib/settings/settings";

export type SettingsFormStatus = "loading" | "error" | "empty" | "ready";

// The props every setting field takes.
export type BoundField = {
  value: string;
  error: string | undefined;
  isChanged: boolean;
  onChange: (value: string) => void;
};

export type SettingsForm = {
  status: SettingsFormStatus;
  isRetrying: boolean;
  retry: () => void;
  valueOf: (key: string) => string;
  setValue: (key: string, value: string) => void;
  // Shows the key's error from now on (a blur after a change).
  touch: (key: string) => void;
  errorOf: (key: string) => string | undefined;
  isChanged: (key: string) => boolean;
  bind: (key: string) => BoundField;
  changeCount: number;
  countIn: (groupId: GroupId) => number;
  hasShownErrors: boolean;
  saveState: SaveState;
  // True when saving would delete chats sooner, so it needs a confirm.
  wouldShortenRetention: boolean;
  save: () => void;
  discard: () => void;
};

const BAD_REQUEST = 400;
const NO_ITEMS: SettingsPage["items"] = [];

type UseSettingsFormOptions = { onSaved: () => void };

function getStatus(
  isPending: boolean,
  isError: boolean,
  count: number,
): SettingsFormStatus {
  let status: SettingsFormStatus = "ready";
  if (isPending) {
    status = "loading";
  } else if (isError) {
    status = "error";
  } else if (count === 0) {
    status = "empty";
  }
  return status;
}

// Drops what was saved; a change typed while the save ran stays.
function withoutSaved(
  draft: Record<string, string>,
  sent: readonly SettingUpdate[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) =>
        !sent.some((update) => update.key === key && update.value === value),
    ),
  );
}

export function useSettingsForm({
  onSaved,
}: UseSettingsFormOptions): SettingsForm {
  const queryClient = useQueryClient();
  const query = useQuery(settingQueries.page());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [hasTriedSave, setHasTriedSave] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [hasSaveFailed, setHasSaveFailed] = useState(false);

  const mutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: (updated, sent) => {
      queryClient.setQueryData(settingQueries.page().queryKey, updated);
      setDraft((current) => withoutSaved(current, sent));
      setTouched(new Set());
      setHasTriedSave(false);
      onSaved();
    },
    onError: (error, sent) => {
      const detail = errorDetail(error);
      const field =
        errorStatus(error) === BAD_REQUEST && detail
          ? findFieldError(detail, sent.map((update) => update.key))
          : null;
      if (field) {
        setServerErrors({ [field.key]: field.message });
      } else {
        setHasSaveFailed(true);
      }
    },
  });

  const items = query.data?.items ?? NO_ITEMS;
  // A load that failed stays "error" while Try again refetches (v5 puts a
  // refetch with no data back to pending), and a failed refetch keeps
  // showing the page it already has.
  const hasLoadFailed = !query.data && query.errorUpdateCount > 0;
  const updates = getChangedUpdates(items, draft);
  const clientErrors = new Map(
    updates.flatMap(({ key, value }) => {
      const error = checkSettingValue(key, value);
      return error ? [[key, error] as const] : [];
    }),
  );
  const isChanged = (key: string) =>
    updates.some((update) => update.key === key);

  function valueOf(key: string): string {
    return draft[key] ?? readSetting(items, key);
  }

  function errorOf(key: string): string | undefined {
    const isShown = hasTriedSave || touched.has(key);
    return (isShown ? clientErrors.get(key) : undefined) ?? serverErrors[key];
  }

  function setValue(key: string, value: string): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setServerErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([errorKey]) => errorKey !== key),
      ),
    );
    setHasSaveFailed(false);
  }

  function touch(key: string): void {
    if (touched.has(key)) return;
    setTouched(new Set([...touched, key]));
  }

  function save(): void {
    if (mutation.isPending || updates.length === 0) return;
    setHasTriedSave(true);
    const hasErrors =
      clientErrors.size > 0 || Object.keys(serverErrors).length > 0;
    if (hasErrors) return;

    setHasSaveFailed(false);
    mutation.mutate(updates);
  }

  function discard(): void {
    setDraft({});
    setTouched(new Set());
    setHasTriedSave(false);
    setServerErrors({});
    setHasSaveFailed(false);
    mutation.reset();
  }

  let saveState: SaveState = "idle";
  if (mutation.isPending) {
    saveState = "saving";
  } else if (hasSaveFailed) {
    saveState = "failed";
  }

  return {
    status: getStatus(
      query.isPending && !hasLoadFailed,
      hasLoadFailed,
      items.length,
    ),
    isRetrying: hasLoadFailed && query.isFetching,
    retry: () => void query.refetch(),
    valueOf,
    setValue,
    touch,
    errorOf,
    isChanged,
    bind: (key) => ({
      value: valueOf(key),
      error: errorOf(key),
      isChanged: isChanged(key),
      onChange: (value) => setValue(key, value),
    }),
    changeCount: updates.length,
    countIn: (groupId) => countChangesIn(groupId, updates),
    hasShownErrors: updates.some((update) => errorOf(update.key) !== undefined),
    saveState,
    wouldShortenRetention: wouldShortenRetention(items, updates),
    save,
    discard,
  };
}
