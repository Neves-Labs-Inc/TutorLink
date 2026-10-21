// The Conversations list: "Needs attention" first (server order), then
// "Other chats" a page at a time ("All chats" when nothing needs
// attention). In the split pane it sits bare in the grid card; on its
// own it is one card holding both sections.
import { useEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { MessageCircle, MessagesSquare } from "lucide-react";
import { Pager } from "@/components/kit/components/pager";
import { useNow } from "@/components/kit/hooks/use-now";
import {
  EmptyState,
  ErrorState,
  InlineError,
  ListSkeleton,
} from "@/components/kit/states/states";
import { CARD, EYEBROW, cn } from "@/components/kit/tokens";
import { ConversationRow } from "@/pages/chats/conversation-row";
import { useConversationFilters } from "@/pages/chats/use-conversation-filters";
import { useConversationList } from "@/pages/chats/use-conversation-list";
import type { ListSection } from "@/pages/chats/use-conversation-list";
import { useAuthStore } from "@/stores/authStore";

type ConversationListProps = {
  openId: string | null;
  onOpen: (id: string) => void;
  isSplit: boolean;
};

export function ConversationList({
  openId,
  onOpen,
  isSplit,
}: ConversationListProps): ReactNode {
  const { filters, isFiltered, setPage } = useConversationFilters();
  const list = useConversationList(filters, setPage);
  const meId = useAuthStore((state) => state.userId);
  const nowMs = useNow();
  const othersHeadingRef = useRef<HTMLHeadingElement>(null);
  const othersBusy = list.status === "ready" && list.others.isBusy;
  const othersPage = list.status === "ready" ? list.others.page : null;
  const othersFailed = list.status === "ready" && list.others.hasPageError;
  const isScrollPending = useRef(false);

  // Once the new page is in, bring its heading back into view.
  useEffect(() => {
    if (othersBusy || !isScrollPending.current) return;
    isScrollPending.current = false;
    // A failed page keeps the old rows where they are.
    if (othersFailed) return;
    scrollToIfAbove(othersHeadingRef);
  }, [othersBusy, othersPage, othersFailed]);

  function wrapState(state: ReactNode): ReactNode {
    return isSplit ? (
      <div className="flex min-h-full items-center justify-center p-6">
        {state}
      </div>
    ) : (
      state
    );
  }

  let content: ReactNode;
  if (list.status === "loading") {
    content = (
      <div className={cn(isSplit && "p-4")}>
        <ListSkeleton rows={5} label="Loading chats" />
      </div>
    );
  } else if (list.status === "error") {
    content = wrapState(
      <ErrorState
        isBare={isSplit}
        title="Couldn’t load chats"
        body="Check your connection and try again."
        onRetry={list.retry}
      />,
    );
  } else {
    const { attention, others } = list;
    const shownCount = attention.total + others.total;
    const hasAttention = attention.items.length > 0;
    const hasOthers = others.items.length > 0;

    let body: ReactNode;
    if (!hasAttention && !hasOthers) {
      body = wrapState(
        isFiltered ? (
          <EmptyState
            isBare={isSplit}
            icon={MessageCircle}
            title="No chats match"
            body="Try another name or number, or clear the filters."
          />
        ) : (
          <EmptyState
            isBare={isSplit}
            icon={MessagesSquare}
            title="No chats yet"
            body="When a Guardian messages the WhatsApp number, their chat shows up here."
          />
        ),
      );
    } else {
      const renderRows = (section: ListSection): ReactNode =>
        section.items.map((chat) => (
          <ConversationRow
            key={chat.id}
            chat={chat}
            meId={meId}
            nowMs={nowMs}
            isSelected={isSplit && chat.id === openId}
            onOpen={onOpen}
          />
        ));
      body = (
        <div className={cn(!isSplit && cn(CARD, "overflow-hidden"))}>
          {hasAttention && (
            <Section
              title="Needs attention"
              section={attention}
              pagerLabel="Needs attention pages"
            >
              {renderRows(attention)}
            </Section>
          )}
          {hasOthers && (
            <Section
              title={hasAttention ? "Other chats" : "All chats"}
              section={others}
              pagerLabel="Chats pages"
              headingRef={othersHeadingRef}
              onPageChange={() => {
                isScrollPending.current = true;
              }}
            >
              {renderRows(others)}
            </Section>
          )}
        </div>
      );
    }

    content = (
      <>
        {body}
        {isFiltered && (
          <p role="status" className="sr-only">
            {shownCount} chats shown
          </p>
        )}
      </>
    );
  }
  return content;
}

type SectionProps = {
  title: string;
  section: ListSection;
  pagerLabel: string;
  headingRef?: RefObject<HTMLHeadingElement | null>;
  onPageChange?: () => void;
  children: ReactNode;
};

function Section({
  title,
  section,
  pagerLabel,
  headingRef,
  onPageChange,
  children,
}: SectionProps): ReactNode {
  return (
    <section aria-label={title} aria-busy={section.isBusy || undefined}>
      <h2
        ref={headingRef}
        className={cn(
          EYEBROW,
          "flex items-center gap-2 border-b border-(--tl-border) bg-(--tl-surface-sunk) px-4 py-2.5 @2xl:px-5",
        )}
      >
        {title} <span className="tabular-nums">· {section.total}</span>
      </h2>
      <ul className="divide-y divide-(--tl-border)">{children}</ul>
      {section.hasPageError && (
        <div className="border-t border-(--tl-border) px-4 py-3">
          <InlineError
            message="Couldn’t load this page. Check your connection."
            onRetry={section.retryPage}
          />
        </div>
      )}
      {section.total > section.pageSize || section.page > 1 ? (
        <div className="border-t border-(--tl-border) px-4 py-3">
          <Pager
            page={section.page}
            pageSize={section.pageSize}
            total={section.total}
            label={pagerLabel}
            isDisabled={section.isBusy}
            onPageChange={(page) => {
              onPageChange?.();
              section.onPageChange(page);
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

function getScrollParent(element: HTMLElement): HTMLElement | null {
  let parent = element.parentElement;
  while (parent) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
    parent = parent.parentElement;
  }
  return null;
}

// Only when the heading has scrolled out above; no smooth scroll. Moves
// the nearest scroller by hand: scrollIntoView would also scroll the
// overflow-hidden kit root, which the user then can't scroll back.
function scrollToIfAbove(ref: RefObject<HTMLElement | null>): void {
  const heading = ref.current;
  if (!heading) return;
  const scroller = getScrollParent(heading);
  const viewTop = scroller?.getBoundingClientRect().top ?? 0;
  const offset = heading.getBoundingClientRect().top - viewTop;
  if (offset >= 0) return;
  if (scroller) {
    scroller.scrollTop += offset;
  } else {
    window.scrollBy(0, offset);
  }
}
