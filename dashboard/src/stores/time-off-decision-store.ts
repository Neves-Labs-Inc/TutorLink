import { create } from "zustand";

// Time off with an Approve or Decline waiting behind its Undo toast. Global,
// so the acts stay hidden after the details close or the page changes,
// for as long as the act is queued.
type TimeOffDecisionState = {
  queuedIds: ReadonlySet<string>;
  queue: (id: string) => void;
  release: (id: string) => void;
};

export const useTimeOffDecisionStore = create<TimeOffDecisionState>((set) => ({
  queuedIds: new Set(),
  queue: (id) =>
    set((state) => ({ queuedIds: new Set(state.queuedIds).add(id) })),
  release: (id) =>
    set((state) => {
      const queuedIds = new Set(state.queuedIds);
      queuedIds.delete(id);
      return { queuedIds };
    }),
}));
