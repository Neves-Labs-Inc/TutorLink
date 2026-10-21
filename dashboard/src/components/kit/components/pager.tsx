// Page-number pager for long lists. The nav is its own size container, so
// the phone/wide switch follows the Pager's width, not the viewport's.
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, IconButton } from "@/components/kit/components/button";
import { cn } from "@/components/kit/tokens";

export type PagerProps = {
  page: number; // 1-based
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  label: string; // nav landmark name, e.g. "Chats pages"
  isDisabled?: boolean; // while a page loads
};

type PageItem = number | "gap";

// Seven slots: first, last, current ±1 and the gaps between them.
const MAX_PAGES_WITHOUT_GAPS = 7;
const LOADING_CLASS =
  "aria-disabled:pointer-events-none aria-disabled:opacity-50";

// Exported from this file by the ticket's contract; it is pure, so fast refresh is unaffected.
// eslint-disable-next-line react-refresh/only-export-components
export function getPageItems(page: number, pageCount: number): PageItem[] {
  if (pageCount <= MAX_PAGES_WITHOUT_GAPS) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const shown = [...new Set([1, page - 1, page, page + 1, pageCount])]
    .filter((n) => n >= 1 && n <= pageCount)
    .sort((a, b) => a - b);

  const items: PageItem[] = [];
  shown.forEach((n, index) => {
    const previous = shown[index - 1];
    if (previous !== undefined && n - previous === 2) {
      items.push(n - 1); // a one-page gap shows the number, not "…"
    } else if (previous !== undefined && n - previous > 2) {
      items.push("gap");
    }
    items.push(n);
  });
  return items;
}

type PageButtonProps = {
  page: number;
  isCurrent: boolean;
  isDisabled: boolean;
  onSelect: (page: number) => void;
};

function PageButton({
  page,
  isCurrent,
  isDisabled,
  onSelect,
}: PageButtonProps): ReactNode {
  return (
    <button
      type="button"
      aria-label={`Page ${page}`}
      aria-current={isCurrent ? "page" : undefined}
      aria-disabled={isDisabled || undefined}
      onClick={isCurrent || isDisabled ? undefined : () => onSelect(page)}
      className={cn(
        "inline-flex h-11 min-w-11 items-center justify-center rounded-full px-2 text-[14px] font-medium tabular-nums transition-colors duration-150 aria-disabled:pointer-events-none aria-disabled:opacity-50",
        isCurrent
          ? "cursor-default bg-(--tl-primary) font-semibold text-(--tl-on-primary)"
          : "cursor-pointer text-(--tl-ink-soft) hover:enabled:bg-(--tl-tint) enabled:active:bg-(--tl-tint-strong)",
      )}
    >
      {page}
    </button>
  );
}

export function Pager({
  page,
  pageSize,
  total,
  onPageChange,
  label,
  isDisabled = false,
}: PagerProps): ReactNode {
  // A page past the end (rows deleted, filter narrowed) keeps the Pager so the user can step back.
  if (total <= pageSize && page <= 1) return null;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const range =
    first > total ? `0 of ${total}` : `${first}–${last} of ${total}`;
  const isFirstPage = page <= 1;
  const isLastPage = page >= pageCount;
  // While loading, controls stay focusable (native disabled would blur the pressed one).
  const goTo = (target: number) => {
    if (!isDisabled) onPageChange(target);
  };

  return (
    <nav
      aria-label={label}
      className="@container flex flex-wrap items-center justify-between gap-x-2 gap-y-2"
    >
      <p
        aria-live="polite"
        className="order-2 text-[14px] font-medium whitespace-nowrap text-(--tl-ink-soft) tabular-nums @2xl:order-none @2xl:font-normal @2xl:text-(--tl-muted)"
      >
        <span className="@2xl:hidden">
          Page {page} of {pageCount}
          <span className="sr-only">, {range}</span>
        </span>
        <span className="hidden @2xl:inline">{range}</span>
      </p>

      <div className="contents @2xl:ml-auto @2xl:flex @2xl:items-center @2xl:gap-2">
        <span className="order-1 @2xl:hidden">
          <IconButton
            key="previous-compact"
            icon={ChevronLeft}
            label="Previous page"
            variant="outline"
            disabled={isFirstPage}
            aria-disabled={isDisabled || undefined}
            className={LOADING_CLASS}
            onClick={() => goTo(Math.min(page - 1, pageCount))}
          />
        </span>
        <Button
          key="previous"
          variant="ghost"
          icon={ChevronLeft}
          className="@max-2xl:hidden aria-disabled:pointer-events-none aria-disabled:opacity-50"
          disabled={isFirstPage}
          aria-disabled={isDisabled || undefined}
          onClick={() => goTo(Math.min(page - 1, pageCount))}
        >
          Previous
        </Button>

        <ul className="hidden items-center gap-2 @2xl:flex">
          {getPageItems(page, pageCount).map((item, index) =>
            item === "gap" ? (
              <li key={`gap-${index}`} aria-hidden>
                <span className="inline-flex h-11 w-6 text-[14px] items-center justify-center text-(--tl-muted)">
                  …
                </span>
              </li>
            ) : (
              <li key={item}>
                <PageButton
                  page={item}
                  isCurrent={item === page}
                  isDisabled={isDisabled}
                  onSelect={onPageChange}
                />
              </li>
            ),
          )}
        </ul>

        <span className="order-3 @2xl:hidden">
          <IconButton
            key="next-compact"
            icon={ChevronRight}
            label="Next page"
            variant="outline"
            disabled={isLastPage}
            aria-disabled={isDisabled || undefined}
            className={LOADING_CLASS}
            onClick={() => goTo(page + 1)}
          />
        </span>
        <Button
          key="next"
          variant="ghost"
          className="@max-2xl:hidden aria-disabled:pointer-events-none aria-disabled:opacity-50"
          disabled={isLastPage}
          aria-disabled={isDisabled || undefined}
          onClick={() => goTo(page + 1)}
        >
          Next
          <ChevronRight aria-hidden className="size-[18px]" />
        </Button>
      </div>
    </nav>
  );
}
