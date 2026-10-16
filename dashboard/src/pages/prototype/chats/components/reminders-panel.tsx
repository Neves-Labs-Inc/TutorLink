// Chats ▸ Reminders: the weekly Booking reminders run. A status card
// (on, off, not set up), a week stepper, then either who the coming run
// will remind (and who it skips, and why) or what a past run did. Each
// Guardian's own Reminders on/off lives on their Guardian details.
import { useState } from "react";
import type { ReactNode } from "react";
import {
  BellOff,
  BellRing,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Settings,
  Users,
} from "lucide-react";
import { Avatar, Badge } from "@/components/kit/components/badges";
import { Button, IconButton, TextLink } from "@/components/kit/components/button";
import { DataTable } from "@/components/kit/components/data-table";
import type { Column } from "@/components/kit/components/data-table";
import { MultiSelectFilter } from "@/components/kit/components/multi-select-filter";
import { QuickFilter } from "@/components/kit/components/quick-filter";
import type { Role } from "@/pages/prototype/shared/mock-data";
import { EmptyState, ErrorState, ListSkeleton, Skeleton } from "@/components/kit/states/states";
import { CARD, CARD_TITLE, cn, EYEBROW } from "@/components/kit/tokens";
import type {
  ReminderPreviewItem,
  ReminderWeekRead,
} from "@/pages/prototype/chats/types/api";
import {
  getReminderOutcome,
  LANGUAGE_LABEL,
  SKIP_REASON_LABEL,
} from "@/pages/prototype/chats/lib/labels";
import {
  formatDayAndTime,
  formatWeekLabel,
} from "@/pages/prototype/chats/lib/time";
import PrototypeNote from "@/pages/prototype/chats/components/prototype-note";

export type PanelLoad = "ready" | "loading" | "error";

type RemindersPanelProps = {
  role: Role;
  week: ReminderWeekRead;
  load: PanelLoad;
  canGoBack: boolean;
  canGoForward: boolean;
  onStep: (step: -1 | 1) => void;
  onOpenGuardianChat: (guardianId: string, name: string) => void;
  onOpenSettings: () => void;
  onRetryLoad: () => void;
};

export default function RemindersPanel({
  role,
  week,
  load,
  canGoBack,
  canGoForward,
  onStep,
  onOpenGuardianChat,
  onOpenSettings,
  onRetryLoad,
}: RemindersPanelProps): ReactNode {
  let content: ReactNode;
  if (load === "loading") {
    content = <ListSkeleton rows={4} label="Loading reminders" />;
  } else if (load === "error") {
    content = (
      <ErrorState
        title="Reminders didn't load"
        body="Check your connection and try again."
        onRetry={onRetryLoad}
      />
    );
  } else if (week.has_run) {
    content = <RunResults week={week} onOpen={onOpenGuardianChat} />;
  } else if (week.reminders !== "on") {
    content = (
      <EmptyState
        icon={BellOff}
        tone="yellow"
        title="Nothing will go out this week"
        body={
          week.reminders === "off"
            ? "Booking reminders are off, so no Guardian gets one."
            : "Booking reminders aren't set up yet, so no Guardian gets one."
        }
      />
    );
  } else {
    content = <Preview items={week.preview ?? []} onOpen={onOpenGuardianChat} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {load === "loading" ? (
        <Skeleton className="h-[104px] w-full rounded-[20px]" />
      ) : (
        <RunStatusCard role={role} week={week} onOpenSettings={onOpenSettings} />
      )}
      <WeekStepper
        week={week}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onStep={onStep}
      />
      {content}
    </div>
  );
}

type RunStatusCardProps = {
  role: Role;
  week: ReminderWeekRead;
  onOpenSettings: () => void;
};

function RunStatusCard({ role, week, onOpenSettings }: RunStatusCardProps): ReactNode {
  const isAdmin = role === "admin";
  const isOn = week.reminders === "on";
  const copy = {
    on: {
      title: week.next_run_at
        ? `Next Booking reminders: ${formatDayAndTime(week.next_run_at)}`
        : "Booking reminders are on",
      body: "Sent weekly to Guardians with Reminders on and nothing booked for the week ahead.",
      action: "Change in Settings",
    },
    off: {
      title: "Booking reminders are off",
      body: "No Guardian gets a weekly reminder until they're turned on.",
      action: "Turn on in Settings",
    },
    not_set_up: {
      title: "Booking reminders aren't set up",
      body: "WhatsApp has to approve the reminder message before the first one can go out.",
      action: "Set up in Settings",
    },
  }[week.reminders];

  return (
    <section
      className={cn(
        CARD,
        "flex flex-col gap-4 p-5 @2xl:flex-row @2xl:items-center @2xl:p-6",
      )}
    >
      <span
        className={cn(
          "inline-flex size-12 shrink-0 items-center justify-center rounded-full",
          isOn
            ? "bg-(--tl-yellow-tint) text-(--tl-yellow-ink)"
            : "bg-(--tl-neutral-tint) text-(--tl-neutral)",
        )}
      >
        {isOn ? (
          <BellRing aria-hidden className="size-6" />
        ) : (
          <BellOff aria-hidden className="size-6" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className={CARD_TITLE}>{copy.title}</h2>
        <p className="text-[14px] leading-5 text-(--tl-muted)">{copy.body}</p>
        {!isAdmin && !isOn && (
          <p className="mt-1 text-[14px] leading-5 text-(--tl-ink-soft)">
            Only an Admin can change this.
          </p>
        )}
      </div>
      {isAdmin &&
        (isOn ? (
          <TextLink onClick={onOpenSettings}>
            <Settings aria-hidden className="size-4" />
            {copy.action}
          </TextLink>
        ) : (
          <Button variant="primary" icon={Settings} onClick={onOpenSettings}>
            {copy.action}
          </Button>
        ))}
    </section>
  );
}

type WeekStepperProps = {
  week: ReminderWeekRead;
  canGoBack: boolean;
  canGoForward: boolean;
  onStep: (step: -1 | 1) => void;
};

function WeekStepper({
  week,
  canGoBack,
  canGoForward,
  onStep,
}: WeekStepperProps): ReactNode {
  const caption = week.has_run ? "Already sent" : "Coming up";
  return (
    <div className="flex items-center gap-2">
      <IconButton
        icon={ChevronLeft}
        label="Earlier week"
        variant="outline"
        disabled={!canGoBack}
        onClick={() => onStep(-1)}
      />
      <div className="min-w-0 flex-1 text-center @2xl:flex-none @2xl:px-3 @2xl:text-left">
        <p className={EYEBROW}>{caption}</p>
        <p className="kit-display text-[20px] leading-7 font-bold">
          {formatWeekLabel(week.week_start)}
        </p>
      </div>
      <IconButton
        icon={ChevronRight}
        label="Later week"
        variant="outline"
        disabled={!canGoForward}
        onClick={() => onStep(1)}
      />
    </div>
  );
}

type PreviewProps = {
  items: ReminderPreviewItem[];
  onOpen: (guardianId: string, name: string) => void;
};

function Preview({ items, onOpen }: PreviewProps): ReactNode {
  const willGet = items.filter((item) => item.skip_reason === null);
  const skipped = items.filter((item) => item.skip_reason !== null);
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Users}
        tone="green"
        title="Nobody to remind this week"
        body="Every Guardian with Reminders on already has a session booked."
      />
    );
  }
  return (
    <div className="grid gap-6 @5xl:grid-cols-2 @5xl:items-start">
      <PreviewGroup
        title="Will get one"
        items={willGet}
        onOpen={onOpen}
        emptyText="Nobody this week."
      />
      <PreviewGroup
        title="Skipped"
        items={skipped}
        onOpen={onOpen}
        emptyText="Nobody is skipped this week."
        note="Skipped Guardians: is there anything the office should do (e.g. hand back a taken-over chat before Sunday)? Open question."
      />
    </div>
  );
}

type PreviewGroupProps = {
  title: string;
  items: ReminderPreviewItem[];
  onOpen: (guardianId: string, name: string) => void;
  emptyText: string;
  note?: string;
};

function PreviewGroup({
  title,
  items,
  onOpen,
  emptyText,
  note,
}: PreviewGroupProps): ReactNode {
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <h3
        className={cn(
          EYEBROW,
          "flex items-center gap-2 border-b border-(--tl-border) bg-(--tl-surface-sunk) px-5 py-2.5",
        )}
      >
        {title} <span className="tabular-nums">· {items.length}</span>
        {note && (
          <span className="ml-auto normal-case">
            <PrototypeNote note={note} />
          </span>
        )}
      </h3>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-[14px] text-(--tl-muted)">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-(--tl-border)">
          {items.map((item) => (
            <li key={item.guardian_id}>
              <button
                type="button"
                onClick={() => onOpen(item.guardian_id, item.guardian_name)}
                className="flex min-h-[68px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-(--tl-tint) focus-visible:-outline-offset-2 @2xl:px-5"
              >
                <Avatar name={item.guardian_name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold">
                    {item.guardian_name}
                  </span>
                  <span className="block truncate text-[13px] text-(--tl-muted)">
                    {item.child_names.join(", ")} ·{" "}
                    {LANGUAGE_LABEL[item.language]}
                  </span>
                </span>
                {item.skip_reason && (
                  <Badge tone="neutral" icon={CircleAlert}>
                    {SKIP_REASON_LABEL[item.skip_reason]}
                  </Badge>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type RunResultsProps = {
  week: ReminderWeekRead;
  onOpen: (guardianId: string, name: string) => void;
};

function RunResults({ week, onOpen }: RunResultsProps): ReactNode {
  const [statuses, setStatuses] = useState<string[]>([]);
  const [isAttentionOnly, setIsAttentionOnly] = useState(false);
  const outcomes = week.rows.map((row) => ({ row, outcome: getReminderOutcome(row) }));
  const attentionCount = outcomes.filter((item) => item.outcome.needsAttention).length;
  const statusOptions = [...new Set(outcomes.map((item) => item.outcome.label))].map(
    (label) => ({ value: label, label }),
  );
  const visible = outcomes.filter(
    (item) =>
      (statuses.length === 0 || statuses.includes(item.outcome.label)) &&
      (!isAttentionOnly || item.outcome.needsAttention),
  );

  if (week.rows.length === 0) {
    return (
      <EmptyState
        icon={BellOff}
        title="No reminders went out this week"
        body="Everyone with Reminders on had a session booked, or reminders were off."
      />
    );
  }

  const columns: Column<(typeof outcomes)[number]>[] = [
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
    { id: "children", header: "Children", render: ({ row }) => row.child_names.join(", ") },
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
            <span className="text-[13px] text-(--tl-muted)">{outcome.detail}</span>
          )}
        </span>
      ),
    },
    {
      id: "sent",
      header: "Sent",
      isWideOnly: true,
      render: ({ row }) => (row.sent_at ? formatDayAndTime(row.sent_at) : "—"),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Filters"
        className="kit-no-scrollbar -mx-4 flex items-center gap-2 overflow-x-auto px-4 @2xl:mx-0 @2xl:flex-wrap @2xl:px-0"
      >
        <QuickFilter
          label={`Needs attention · ${attentionCount}`}
          icon={CircleAlert}
          isOn={isAttentionOnly}
          onToggle={() => setIsAttentionOnly((current) => !current)}
        />
        <MultiSelectFilter
          label="Outcome"
          options={statusOptions}
          selected={statuses}
          onChange={setStatuses}
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
          caption={`Booking reminders, ${formatWeekLabel(week.week_start)}`}
          rows={visible}
          columns={columns}
          getRowId={({ row }) => row.guardian_id}
          getRowTitle={({ row }) => row.guardian_name}
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
