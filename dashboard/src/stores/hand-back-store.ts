import { create } from "zustand";

// Chats handed back to the bot whose release still waits behind its Undo
// toast. Global, so a refetch in that window (a Guardian message, a
// reconnect) can't show the chat as taken over again. Each Hand back gets
// its own token, so a superseded act (a Take over, then a second Hand
// back) can't send, undo or release the newer one.
type HandBackState = {
  // Chat id → the token of the Hand back that owns its Undo window.
  pending: ReadonlyMap<string, number>;
  queue: (id: string) => number;
  // Without a token (a Take over), drops whichever act is pending.
  release: (id: string, token?: number) => void;
};

let nextToken = 1;

export const useHandBackStore = create<HandBackState>((set) => ({
  pending: new Map(),
  queue: (id) => {
    const token = nextToken;
    nextToken += 1;
    set((state) => ({ pending: new Map(state.pending).set(id, token) }));
    return token;
  },
  release: (id, token) =>
    set((state) => {
      if (token !== undefined && state.pending.get(id) !== token) return state;
      const pending = new Map(state.pending);
      pending.delete(id);
      return { pending };
    }),
}));
