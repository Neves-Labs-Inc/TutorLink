// Hand back as a reversible act (DESIGN.md §11.6): the chat shows Bot at
// once, and the release goes out when the Undo window ends (or at once,
// with keepalive, if the page hides first). Undo sends nothing.
import { useQueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import { useDeferredAction } from "@/components/kit/overlays/use-deferred-action";
import { getDetailKey } from "@/hooks/use-chat-thread";
import {
  COMPOSER_TARGETS,
  FIRST_CONTROL_TARGETS,
} from "@/hooks/use-footer-focus";
import { getKeepaliveConfig, api } from "@/lib/api";
import { getHandedBackDetail, getHandedBackRow } from "@/lib/chats/hand-back";
import { getFirstName } from "@/lib/chats/labels";
import type {
  Conversation,
  ConversationDetail,
} from "@/lib/queries/conversations";
import { countsQueries } from "@/lib/queries/counts";
import type { Page } from "@/lib/queries/page";
import { useFooterFocusStore } from "@/stores/footer-focus-store";
import { useHandBackStore } from "@/stores/hand-back-store";

const LIST_KEY: QueryKey = ["conversations", "list"];

function patchRows(
  page: Page<Conversation> | undefined,
  conversationId: string,
): Page<Conversation> | undefined {
  if (page === undefined) return page;
  if (!page.items.some((row) => row.id === conversationId)) return page;
  return {
    ...page,
    items: page.items.map((row) =>
      row.id === conversationId ? getHandedBackRow(row) : row,
    ),
  };
}

function getReleasePath(conversationId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/takeover`;
}

export function useHandBack(): (detail: ConversationDetail) => void {
  const queryClient = useQueryClient();
  const { defer } = useDeferredAction();

  return function handBack(detail: ConversationDetail): void {
    const conversationId = detail.id;
    const detailKey = getDetailKey(conversationId);
    const firstName =
      detail.guardian === null
        ? "this number"
        : getFirstName(detail.guardian.name);
    const { queue, release } = useHandBackStore.getState();
    const { requestFocus } = useFooterFocusStore.getState();
    const previousDetail =
      queryClient.getQueryData<ConversationDetail>(detailKey) ?? detail;
    const previousLists = queryClient.getQueriesData<Page<Conversation>>({
      queryKey: LIST_KEY,
    });

    // A fetch already in flight would land the held chat over the patch.
    void queryClient.cancelQueries({ queryKey: detailKey, exact: true });
    void queryClient.cancelQueries({ queryKey: LIST_KEY });
    const token = queue(conversationId);
    // False once a Take over or a later Hand back superseded this act.
    const isCurrent = (): boolean =>
      useHandBackStore.getState().pending.get(conversationId) === token;
    queryClient.setQueryData(detailKey, getHandedBackDetail(previousDetail));
    queryClient.setQueriesData<Page<Conversation>>(
      { queryKey: LIST_KEY },
      (page) => patchRows(page, conversationId),
    );
    // The pressed control unmounts with the footer it sat in.
    requestFocus(conversationId, FIRST_CONTROL_TARGETS);

    defer({
      message: `Handed back. The bot is answering ${firstName}.`,
      // Taking the chat back over inside the window supersedes the release.
      commit: async ({ keepalive }) => {
        if (!isCurrent()) return;
        await api.delete(
          getReleasePath(conversationId),
          getKeepaliveConfig(keepalive),
        );
      },
      onUndo: () => {
        // Superseded: the chat is mine again, or a newer act owns it.
        if (!isCurrent()) return;
        release(conversationId, token);
        queryClient.setQueryData(detailKey, previousDetail);
        for (const [key, page] of previousLists) {
          queryClient.setQueryData(key, page);
        }
        requestFocus(conversationId, COMPOSER_TARGETS);
      },
      onCommitted: () => {
        // Skipped when superseded: nothing was sent.
        if (!isCurrent()) return;
        // A refetch inside the window cached the held copy; keep the bot
        // on screen until the invalidation below brings the released one.
        queryClient.setQueryData<ConversationDetail>(detailKey, (current) =>
          current === undefined ? current : getHandedBackDetail(current),
        );
        release(conversationId, token);
        void queryClient.invalidateQueries({
          queryKey: detailKey,
          exact: true,
        });
        void queryClient.invalidateQueries({ queryKey: LIST_KEY });
        void queryClient.invalidateQueries({
          queryKey: countsQueries.detail().queryKey,
        });
      },
      errorMessage: `Couldn’t hand back the chat with ${firstName}. Try again.`,
      onError: () => {
        release(conversationId, token);
        void queryClient.invalidateQueries({
          queryKey: detailKey,
          exact: true,
        });
        void queryClient.invalidateQueries({ queryKey: LIST_KEY });
      },
    });
  };
}
