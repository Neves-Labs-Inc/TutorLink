// Prototype-only shared state for Homes, so a change made in Guardian
// details shows on the Child's profile too. In-memory; resets on reload.
import { useSyncExternalStore } from "react";
import { HOMES } from "@/pages/prototype/shared/mock-data";
import type { Home } from "@/pages/prototype/shared/mock-data";

let homes: Home[] = HOMES;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setHomes(next: Home[]): void {
  homes = next;
  for (const listener of listeners) listener();
}

type HomesStore = {
  homes: Home[];
  saveHome: (home: Home) => void;
  setArchived: (id: string, isArchived: boolean) => void;
};

export function useHomes(): HomesStore {
  const current = useSyncExternalStore(subscribe, () => homes);

  function saveHome(home: Home): void {
    const exists = current.some((item) => item.id === home.id);
    setHomes(
      exists
        ? current.map((item) => (item.id === home.id ? home : item))
        : [...current, home],
    );
  }

  function setArchived(id: string, isArchived: boolean): void {
    setHomes(current.map((item) => (item.id === id ? { ...item, isArchived } : item)));
  }

  return { homes: current, saveHome, setArchived };
}
