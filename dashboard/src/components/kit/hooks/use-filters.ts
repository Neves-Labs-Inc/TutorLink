// State for a row of MultiSelectFilters: one selected list per field.
// An empty list means "no filter on this field".
import { useState } from "react";

type Filters<K extends string> = {
  selected: Record<K, string[]>;
  set: (key: K, values: string[]) => void;
  clearAll: () => void;
  activeCount: number;
  matches: (key: K, value: string | string[]) => boolean;
};

export function useFilters<K extends string>(
  initial: Record<K, string[]>,
): Filters<K> {
  const [selected, setSelected] = useState(initial);
  // Keys come from `initial`, so every entry is a K.
  const keys = Object.keys(selected) as K[];
  const activeCount = keys.filter((key) => selected[key].length > 0).length;

  function set(key: K, values: string[]): void {
    setSelected((current) => ({ ...current, [key]: values }));
  }

  function clearAll(): void {
    setSelected((current) => {
      const cleared = keys.map((key) => [key, []] as const);
      return { ...current, ...Object.fromEntries(cleared) };
    });
  }

  // A row matches a field when nothing is picked, or any of its values is.
  function matches(key: K, value: string | string[]): boolean {
    const picked = selected[key];
    const values = Array.isArray(value) ? value : [value];
    return picked.length === 0 || values.some((item) => picked.includes(item));
  }

  return { selected, set, clearAll, activeCount, matches };
}
