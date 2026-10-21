// The one row shell of every To do card. The whole row is the link (a
// chat, a family, a Time off request) or the button (Booking details, an
// Evaluation to book); there are no buttons inside it (DESIGN §11.2).
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

export type TodoRowAction = { to: string } | { onOpen: () => void };

// The muted line under a row's title.
export const TODO_DETAIL =
  "mt-1 block truncate text-[13px] leading-[18px] text-(--tl-muted) tabular-nums";

const ROW =
  "group flex min-h-14 w-full cursor-pointer items-start gap-3 rounded-[14px] px-2 py-2.5 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong)";

type TodoRowProps = {
  action: TodoRowAction;
  title: string;
  // Beside the title, wrapping under it on narrow cards.
  titleAside?: ReactNode;
  // A badge on its own line under the title.
  badge?: ReactNode;
  leading?: ReactNode;
  // Replaces the chevron.
  trailing?: ReactNode;
  children?: ReactNode;
};

export default function TodoRow({
  action,
  title,
  titleAside,
  badge,
  leading,
  trailing,
  children,
}: TodoRowProps): ReactNode {
  const content = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate text-[15px] leading-6 font-semibold">
            {title}
          </span>
          {titleAside}
        </span>
        {badge && <span className="mt-0.5 flex">{badge}</span>}
        {children}
      </span>
      {trailing ?? (
        <ChevronRight
          aria-hidden
          className="mt-0.5 size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5"
        />
      )}
    </>
  );
  return (
    <li className="border-b border-(--tl-border) py-1 last:border-b-0">
      {"to" in action ? (
        <Link to={action.to} className={ROW}>
          {content}
        </Link>
      ) : (
        <button type="button" onClick={action.onOpen} className={ROW}>
          {content}
        </button>
      )}
    </li>
  );
}
