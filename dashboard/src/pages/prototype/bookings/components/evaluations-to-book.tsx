// Evaluations to book (GET /api/children?evaluable=true), shown on the
// Needs attention landing above the Bookings. The row opens the Child;
// Book evaluation sits outside it and opens New booking prefilled.
import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/pages/prototype/shell-kit/kit/components/button";
import { CARD, cn } from "@/pages/prototype/shell-kit/kit/tokens";
import {
  formatGrade,
  getDaysSince,
  pluralize,
} from "@/pages/prototype/bookings/lib/format";
import type { ChildSummary } from "@/pages/prototype/bookings/lib/wire";

type EvaluationsToBookProps = {
  waiting: ChildSummary[];
  onOpenChild: (child: ChildSummary) => void;
  onBook: (child: ChildSummary) => void;
};

export default function EvaluationsToBook({
  waiting,
  onOpenChild,
  onBook,
}: EvaluationsToBookProps): ReactNode {
  if (waiting.length === 0) return null;
  return (
    <section aria-labelledby="evaluations-to-book" className="mb-8">
      <h2 id="evaluations-to-book" className="flex items-baseline gap-3 px-1 pb-3">
        <span className="kit-display text-[18px] font-bold">Evaluations to book</span>
        <span className="text-[14px] text-(--tl-muted)">
          {pluralize(waiting.length, "Child", "Children")}
        </span>
      </h2>
      <ul className={cn(CARD, "@container divide-y divide-(--tl-border)")}>
        {waiting.map((child) => (
          <li
            key={child.id}
            className="flex flex-col gap-2 px-4 py-3 @xl:flex-row @xl:items-center @xl:gap-4 @xl:px-5"
          >
            <button
              type="button"
              onClick={() => onOpenChild(child)}
              className="-m-2 flex min-h-14 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[14px] p-2 text-left transition-colors duration-150 hover:bg-(--tl-tint)"
            >
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-(--tl-pink-tint) text-(--tl-pink-ink)">
                <Sparkles aria-hidden className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{child.name}</span>
                <span className="block truncate text-[13px] text-(--tl-muted)">
                  {formatGrade(child.grade_level)} ·{" "}
                  {child.guardians.map((guardian) => guardian.name).join(", ")} · waiting{" "}
                  {pluralize(getDaysSince(child.created_at), "day", "days")}
                </span>
              </span>
            </button>
            <Button variant="soft" onClick={() => onBook(child)} className="@max-xl:w-full">
              Book evaluation
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
