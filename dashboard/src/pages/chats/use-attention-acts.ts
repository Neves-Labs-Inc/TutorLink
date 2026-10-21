// What the Needs attention card does: Mark done (with a server Undo) and
// the Reactivation request decision. The acts are plain async functions,
// not mutations, so the Undo on a toast still works after the card is gone.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/kit/overlays/use-toast";
import {
  isFlagChangedError,
  markConversationHandled,
  undoConversationHandled,
} from "@/lib/chatThread";
import { getFirstName } from "@/lib/chats/labels";
import { conversationQueries } from "@/lib/queries/conversations";
import type {
  ConversationDetail,
  ReactivationRequest,
} from "@/lib/queries/conversations";
import {
  approveReactivation,
  denyReactivation,
} from "@/lib/queries/conversations";
import { countsQueries } from "@/lib/queries/counts";

export type AttentionAct = "mark-done" | "restore" | "decline";

export function getActAttributes(conversationId: string, act: AttentionAct) {
  return { "data-attention-chat": conversationId, "data-attention-act": act };
}

// Scoped to one chat so a focus return never lands on another chat's card.
export function getActSelector(conversationId: string, act: AttentionAct): string {
  return `[data-attention-chat="${conversationId}"][data-attention-act="${act}"]`;
}

const FOOTER_CONTROL_SELECTOR =
  '[data-slot="thread-footer"] :is(button, a[href], input, textarea, select, [tabindex]):not([disabled], [tabindex="-1"])';

const FLAG_CHANGED_ALERT =
  "The reason changed since you opened this chat. Check it and try again.";
const SETTLED_ALERT = "This request was already settled.";
const UNDO_FAILED_TOAST = "Couldn’t undo. The chat has changed since.";
const UNDO_NETWORK_TOAST = "Couldn’t undo. Try again.";

const RELATED_LISTS = [["children"], ["guardians"], ["households"]];

// Waits for React to commit the swap before looking for the element.
function focusWhenCommitted(selector: string): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(selector)?.focus();
    });
  });
}

type AttentionActs = {
  pendingAct: AttentionAct | null;
  alert: string | null;
  markDone: () => Promise<void>;
  restore: () => Promise<void>;
  decline: () => Promise<void>;
};

export function useAttentionActs(
  conversation: ConversationDetail,
): AttentionActs {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [pendingAct, setPendingAct] = useState<AttentionAct | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const { id, flagged_at: flaggedAt } = conversation;
  const child: ReactivationRequest["child"] | null =
    conversation.reactivation_request?.child ?? null;
  const childFirst = child === null ? "" : getFirstName(child.name);
  const guardianFirst =
    conversation.guardian === null
      ? "the Guardian"
      : getFirstName(conversation.guardian.name);

  function applyDetail(updated: ConversationDetail): void {
    queryClient.setQueryData(conversationQueries.detail(id).queryKey, updated);
    void queryClient.invalidateQueries({ queryKey: ["conversations", "list"] });
    void queryClient.invalidateQueries({
      queryKey: countsQueries.detail().queryKey,
    });
  }

  function refetchDetail(): void {
    void queryClient.invalidateQueries({
      queryKey: conversationQueries.detail(id).queryKey,
      exact: true,
    });
  }

  async function undo(): Promise<void> {
    try {
      applyDetail(await undoConversationHandled(id));
      focusWhenCommitted(getActSelector(id, "mark-done"));
    } catch (error) {
      if (isFlagChangedError(error)) {
        refetchDetail();
        showToast({ tone: "error", message: UNDO_FAILED_TOAST });
      } else {
        console.warn("attention card: undo failed", { id, error });
        showToast({ tone: "error", message: UNDO_NETWORK_TOAST });
      }
    }
  }

  async function run(
    act: AttentionAct,
    request: () => Promise<ConversationDetail>,
    conflictAlert: string,
    failure: string,
    onDone: () => void,
  ): Promise<void> {
    setPendingAct(act);
    setAlert(null);
    try {
      applyDetail(await request());
      if (act !== "mark-done") {
        for (const key of RELATED_LISTS) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
      onDone();
      focusWhenCommitted(FOOTER_CONTROL_SELECTOR);
    } catch (error) {
      if (isFlagChangedError(error)) {
        refetchDetail();
        setAlert(conflictAlert);
      } else {
        console.warn("attention card: act failed", { id, act, error });
        setAlert(`Couldn’t ${failure}. Try again.`);
      }
      // The busy button was disabled, which dropped focus to <body>.
      focusWhenCommitted(getActSelector(id, act));
    } finally {
      setPendingAct(null);
    }
  }

  return {
    pendingAct,
    alert,
    markDone: () =>
      run(
        "mark-done",
        () => markConversationHandled(id, flaggedAt ?? ""),
        FLAG_CHANGED_ALERT,
        "mark it done",
        () =>
          showToast({
            tone: "success",
            message: "Marked done.",
            actionLabel: "Undo",
            onAction: () => void undo(),
          }),
      ),
    restore: () =>
      run(
        "restore",
        () => approveReactivation(id),
        SETTLED_ALERT,
        `restore ${childFirst}`,
        () => showToast({ tone: "success", message: `${childFirst} restored.` }),
      ),
    decline: () =>
      run(
        "decline",
        () => denyReactivation(id),
        SETTLED_ALERT,
        "decline the request",
        () =>
          showToast({
            tone: "success",
            message: `Request declined. Let ${guardianFirst} know.`,
          }),
      ),
  };
}
