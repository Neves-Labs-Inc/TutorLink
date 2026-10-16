// Prototype-only: the requests the current screen would make, so the
// wiring can be read straight off the page. Not part of the design.
import type { ReactNode } from "react";
import { Badge } from "@/components/kit/components/badges";
import type { BookingsPageState } from "@/pages/prototype/bookings/hooks/use-bookings-page";
import { buildQueryString } from "@/pages/prototype/bookings/lib/rules";

type WireNoteProps = { state: BookingsPageState };

export default function WireNote({ state }: WireNoteProps): ReactNode {
  const lines = [
    `${buildQueryString(state.query)}   → total ${state.page.total}, counts_by_kind ${JSON.stringify(state.page.counts_by_kind)}`,
  ];
  if (state.isAttentionOnly) {
    lines.push("Needs attention = ?to_sort_out=true (not marked, Time off clash, archived Staff).");
    lines.push(`GET /api/children?evaluable=true   → Page[ChildSummary], ${state.evaluations.length} Evaluations to book`);
    if (state.role === "manager") {
      lines.push("Manager: the API limits ?to_sort_out=true to their own Bookings.");
    }
  }
  lines.push(
    `GET /api/counts   → nav badge ${state.badgeCount} = bookings_to_sort_out + children_awaiting_evaluation`,
  );
  if (state.openId) lines.push(`GET /api/bookings/${state.openId}`);
  return (
    <details className="mt-10 rounded-[14px] border border-dashed border-(--tl-border) px-3 py-2 text-[12px] text-(--tl-muted)">
      <summary className="cursor-pointer font-semibold">
        <Badge tone="neutral">Prototype</Badge> Requests this screen makes
      </summary>
      <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-5 whitespace-pre-wrap">
        {lines.join("\n")}
      </pre>
    </details>
  );
}
