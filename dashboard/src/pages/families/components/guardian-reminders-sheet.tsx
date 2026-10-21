// Booking reminders: the Guardian's current choice, the last reminder,
// one button to record the other choice (it sends them nothing), and
// the history of choices, newest first. While WhatsApp blocks the
// number only the Guardian can turn reminders back on.
import { useId } from "react";
import type { ReactNode } from "react";
import { BellOff, BellRing, TriangleAlert } from "lucide-react";
import { RemindersBadge } from "@/components/kit/components/badges";
import { Button } from "@/components/kit/components/button";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { InlineError, Skeleton } from "@/components/kit/states/states";
import { cn, EYEBROW } from "@/components/kit/tokens";
import {
  CONSENT_ACTION_LABELS,
  formatChoiceDate,
  formatChoiceWho,
  formatLastReminder,
  getRemindersLabel,
} from "@/lib/families/guardian-labels";
import SheetFailureLine from "@/pages/families/components/sheet-failure-line";
import { useGuardianReminders } from "@/pages/families/hooks/use-guardian-reminders";
import type { GuardianReminders } from "@/pages/families/hooks/use-guardian-reminders";
import type { ClientRead } from "@/types/families";

const HISTORY_SKELETON_ROWS = 3;

type GuardianRemindersSheetProps = {
  guardian: ClientRead;
  isOpen: boolean;
  onClose: () => void;
};

export default function GuardianRemindersSheet({
  guardian,
  isOpen,
  onClose,
}: GuardianRemindersSheetProps): ReactNode {
  const reminders = useGuardianReminders(guardian, isOpen);
  const { history, nextAction } = reminders;
  const isTurningOff = nextAction === "opt_out";
  const historyHeadingId = useId();
  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title="Booking reminders"
      footer={
        <Button variant="soft" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RemindersBadge state={getRemindersLabel(reminders.state)} />
        {history.data ? (
          <p className="text-[13px] leading-[18px] text-(--tl-muted) tabular-nums">
            {formatLastReminder(history.data.last_reminder?.week_start ?? null)}
          </p>
        ) : (
          history.isPending && <Skeleton className="h-3 w-28 rounded-full" />
        )}
      </div>
      {nextAction !== null && (
        <>
          <p className="mt-4 text-[13px] leading-[18px] text-(--tl-muted)">
            This records what they told you. The Guardian gets no message.
          </p>
          <Button
            className="mt-3 w-full @md:w-auto"
            icon={isTurningOff ? BellOff : BellRing}
            isLoading={reminders.isRecording}
            onClick={reminders.record}
          >
            {`Record ${CONSENT_ACTION_LABELS[nextAction]}`}
          </Button>
        </>
      )}
      {reminders.isBlocked && <BlockedNote />}
      {reminders.recordError && (
        <div className="mt-4">
          <SheetFailureLine message={reminders.recordError} />
        </div>
      )}
      <section aria-labelledby={historyHeadingId} className="mt-6">
        <h3 id={historyHeadingId} className={cn(EYEBROW, "mb-1")}>
          History
        </h3>
        <ReminderHistory reminders={reminders} />
      </section>
    </BottomSheet>
  );
}

function BlockedNote(): ReactNode {
  return (
    <p
      role="note"
      className="mt-4 flex items-start gap-2 rounded-[16px] bg-(--tl-warning-tint) px-4 py-3 text-[14px] leading-5 text-(--tl-warning)"
    >
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      They turned reminders off in WhatsApp. Only they can turn them back on,
      by messaging START.
    </p>
  );
}

type ReminderHistoryProps = { reminders: GuardianReminders };

function ReminderHistory({ reminders }: ReminderHistoryProps): ReactNode {
  const { history, newRowId } = reminders;
  if (history.isError && !history.data) {
    return (
      <InlineError
        message="Couldn’t load reminders history. Check your connection."
        onRetry={() => void history.refetch()}
        isRetrying={history.isFetching}
      />
    );
  }
  if (!history.data) {
    return (
      <div role="status" aria-label="Loading reminders history">
        {Array.from({ length: HISTORY_SKELETON_ROWS }, (_, index) => (
          <div key={index} className="flex items-center gap-3 py-3">
            <Skeleton className="h-3 w-20 rounded-full" />
            <Skeleton className="h-4 w-24 rounded-full" />
            <Skeleton className="h-3 w-28 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  const rows = history.data.history;
  return rows.length === 0 ? (
    <p className="py-3 text-[13px] leading-[18px] text-(--tl-muted)">
      No choices recorded yet
    </p>
  ) : (
    <ol className="divide-y divide-(--tl-border)">
      {rows.map((row) => (
        <li
          key={row.id}
          className={cn(
            "flex flex-wrap items-baseline gap-x-3 py-3",
            row.id === newRowId && "kit-rise",
          )}
        >
          <span className="w-[104px] text-[13px] text-(--tl-muted) tabular-nums">
            {formatChoiceDate(row.created_at)}
          </span>
          <span className="text-[14px] font-semibold">
            {CONSENT_ACTION_LABELS[row.action]}
          </span>
          <span className="text-[13px] text-(--tl-muted)">
            {formatChoiceWho(row.who)}
          </span>
        </li>
      ))}
    </ol>
  );
}
