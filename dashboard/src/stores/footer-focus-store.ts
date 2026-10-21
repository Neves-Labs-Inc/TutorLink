import { create } from "zustand";
import { focusRequest } from "@/lib/chatThread";
import type { FocusRequest } from "@/lib/chatThread";

// Where focus goes once a chat's footer swaps state: the control that
// had it (Take over, Hand back) is about to unmount. The footer of that
// chat takes the request on its next render; it lapses if the chat is
// no longer on screen.
type FooterFocusState = {
  conversationId: string | null;
  request: FocusRequest | null;
  requestFocus: (conversationId: string, targets: string[]) => void;
  clear: () => void;
};

export const useFooterFocusStore = create<FooterFocusState>((set) => ({
  conversationId: null,
  request: null,
  requestFocus: (conversationId, targets) =>
    set({ conversationId, request: focusRequest(targets, Date.now()) }),
  clear: () => set({ conversationId: null, request: null }),
}));
