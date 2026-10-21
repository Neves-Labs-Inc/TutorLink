import { useState } from "react";
import type { ReactNode } from "react";
import { BellOff, CircleAlert, Users } from "lucide-react";
import { Avatar, Badge } from "@/components/kit/components/badges";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column } from "@/components/kit/components/data-table";
import { MultiSelectFilter } from "@/components/kit/components/multi-select-filter";
import { QuickFilter } from "@/components/kit/components/quick-filter";
import { EmptyState } from "@/components/kit/states/states";
import {
  getReminderOutcome,
  LANGUAGE_LABEL,
} from "@/lib/chats/labels";
import type { ReminderOutcome } from "@/lib/chats/labels";
import { formatDayAndTime, formatWeekLabel } from "@/lib/chats/time";
import { NO_VALUE } from "@/lib/reminders/reminders";
import type { ReminderRow } from "@/lib/reminders/reminders";

type ResultRow = { row: ReminderRow; outcome: ReminderOutcome };

const COLUMNS: Column<ResultRow>[] = [
  {
    id: "guardian",
    header: "Guardian",
    render: ({ row }) => (
      <span className="flex items-center gap-3">
        <Avatar name={row.guardian_name} />
        <span className="font-semibold">{row.guardian_name}</span>
      </span>
    ),
  },
  {
    id: "children",
    header: "Children",
    render: ({ row }) => row.child_names.join(", "),
  },
  {
    id: "language",
    header: "Language",
    isWideOnly: true,
    render: ({ row }) => LANGUAGE_LABEL[row.language],
  },
  {
    id: "outcome",
    header: "Outcome",
    render: ({ outcome }) => (
      <span className="flex flex-col items-start gap-1">
        <Badge tone={outcome.tone} hasDot>
          {outcome.label}
        </Badge>
        {outcome.detail && (
          <span className="text-[13px] leading-[18px] text-(--tl-muted)">
            {outcome.detail}
          </span>
        )}
      </span>
    ),
  },
  {
    id: "sent",
    header: "Sent",
    isWideOnly: true,
    render: ({ row }) => (row.sent_at ? formatDayAndTime(row.sent_at) : NO_VALUE),
  },
];

type RemindersResultsProps = {
  weekStart: string;
  rows: ReminderRow[];
  openingId: string | null;
  onOpen: (guardianId: string, name: string) => void;
};

// What a past run did. Keyed by week in the parent, so filters reset on a week change.
export function RemindersResults({
  weekStart,
  rows,
  openingId,
  onOpen,
}: RemindersResultsProps): ReactNode {
  const [outcomeLabels, setOutcomeLabels] = useState<string[]>([]);
  const [isAttentionOnly, setIsAttentionOnly] = useState(false);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={BellOff}
        title="No reminders went out this week"
        body="Everyone with Reminders on had a session booked, or reminders were off."
      />
    );
  }

  const results = rows.map((row) => ({ row, outcome: getReminderOutcome(row) }));
  const attentionCount = results.filter(
    (result) => result.outcome.needsAttention,
  ).length;
  const outcomeOptions = [
    ...new Set(results.map((result) => result.outcome.label)),
  ].map((label) => ({ value: label, label }));
  const visible = results.filter(
    (result) =>
      (outcomeLabels.length === 0 ||
        outcomeLabels.includes(result.outcome.label)) &&
      (!isAttentionOnly || result.outcome.needsAttention),
  );

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Filters"
        className="kit-no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 @2xl:mx-0 @2xl:flex-wrap @2xl:px-0"
      >
        {(attentionCount > 0 || isAttentionOnly) && (
          <QuickFilter
            label={`Needs attention · ${attentionCount}`}
            icon={CircleAlert}
            isOn={isAttentionOnly}
            onToggle={() => setIsAttentionOnly((current) => !current)}
          />
        )}
        <MultiSelectFilter
          label="Outcome"
          options={outcomeOptions}
          selected={outcomeLabels}
          onChange={setOutcomeLabels}
        />
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nothing matches"
          body="Turn off a filter to see more."
        />
      ) : (
        <DataTable
          caption={`Booking reminders, ${formatWeekLabel(weekStart)}`}
          rows={visible}
          columns={COLUMNS}
          getRowId={({ row }) => row.guardian_id}
          getRowTitle={({ row }) => row.guardian_name}
          isRowBusy={({ row }) => row.guardian_id === openingId}
          onOpenRow={({ row }) => onOpen(row.guardian_id, row.guardian_name)}
          getPhoneRow={({ row, outcome }) => ({
            leading: <Avatar name={row.guardian_name} />,
            title: row.guardian_name,
            subtitle: `${row.child_names.join(", ")} · ${LANGUAGE_LABEL[row.language]}`,
            meta: outcome.detail ?? undefined,
            trailing: (
              <Badge tone={outcome.tone} hasDot>
                {outcome.label}
              </Badge>
            ),
          })}
        />
      )}
    </div>
  );
}
