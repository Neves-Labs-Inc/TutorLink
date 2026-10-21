// Take over (from the bot, no confirm) and Take over from a colleague
// (POST /transfer, behind a confirm). Success swaps the footer to the
// composer and focuses it; a refusal refetches the detail first, so the
// alert can say why with what the server now says.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { getDetailKey } from "@/hooks/use-chat-thread";
import { COMPOSER_TARGETS } from "@/hooks/use-footer-focus";
import { takeoverConversation } from "@/lib/chatThread";
import { transferConversation } from "@/lib/queries/conversations";
import type { ConversationDetail } from "@/lib/queries/conversations";
import { useFooterFocusStore } from "@/stores/footer-focus-store";
import { useHandBackStore } from "@/stores/hand-back-store";

const GENERIC_TAKEOVER_ERROR = "Couldn’t take over. Try again.";
const TRANSFER_ERROR =
  "Couldn’t take over. The chat changed; check it and try again.";

type Act = "takeover" | "transfer";

export type Takeover = {
  pending: Act | null;
  takeoverError: string | null;
  transferError: string | null;
  takeOver: () => Promise<void>;
  // Resolves true once the chat is mine, so the dialog can close.
  transfer: () => Promise<boolean>;
  clearTransferError: () => void;
};

const REQUESTS: Record<Act, (id: string) => Promise<ConversationDetail>> = {
  takeover: takeoverConversation,
  transfer: transferConversation,
};

export function useTakeover(
  conversationId: string,
  firstName: string,
): Takeover {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Act | null>(null);
  const [takeoverError, setTakeoverError] = useState<string | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const detailKey = getDetailKey(conversationId);

  async function run(act: Act): Promise<boolean> {
    setPending(act);
    setTakeoverError(null);
    setTransferError(null);
    let isDone = false;
    try {
      const updated = await REQUESTS[act](conversationId);
      // A Hand back still in its Undo window is superseded: it won't send.
      useHandBackStore.getState().release(conversationId);
      queryClient.setQueryData(detailKey, updated);
      useFooterFocusStore
        .getState()
        .requestFocus(conversationId, COMPOSER_TARGETS);
      isDone = true;
    } catch (error) {
      // Only the status: the error's request config carries the token.
      const httpStatus = axios.isAxiosError(error)
        ? (error.response?.status ?? null)
        : null;
      console.warn("chat takeover refused", { conversationId, act, httpStatus });
      await queryClient
        .refetchQueries({ queryKey: detailKey, exact: true })
        .catch(() => undefined);
      const fresh = queryClient.getQueryData<ConversationDetail>(detailKey);
      const isClosed = fresh !== undefined && !fresh.is_window_open;
      if (act === "transfer") {
        setTransferError(TRANSFER_ERROR);
      } else if (isClosed) {
        setTakeoverError(
          `Couldn’t take over. ${firstName}’s 24-hour window has closed.`,
        );
      } else {
        setTakeoverError(GENERIC_TAKEOVER_ERROR);
      }
      // The pending button lost focus. Named from the fresh detail: the
      // refetch may not have rendered yet, and the old button would take
      // focus just before the closed notice replaces it.
      if (act === "takeover") {
        useFooterFocusStore
          .getState()
          .requestFocus(conversationId, [
            isClosed ? "[data-copy-number]" : "[data-takeover]",
          ]);
      }
    }
    setPending(null);
    return isDone;
  }

  return {
    pending,
    takeoverError,
    transferError,
    takeOver: async () => {
      await run("takeover");
    },
    transfer: () => run("transfer"),
    clearTransferError: () => setTransferError(null),
  };
}
