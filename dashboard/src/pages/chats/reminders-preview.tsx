import type { ReactNode } from "react";
import { ChevronRight, CircleAlert, LoaderCircle, Users } from "lucide-react";
import { Avatar, Badge } from "@/components/kit/components/badges";
import { EmptyState } from "@/components/kit/states/states";
import { CARD, cn, EYEBROW } from "@/components/kit/tokens";
import { LANGUAGE_LABEL, SKIP_REASON_LABEL } from "@/lib/chats/labels";
import type { ReminderPreviewItem } from "@/lib/reminders/reminders";

type OnOpen = (guardianId: string, name: string) => void;

type RemindersPreviewProps = {
  items: ReminderPreviewItem[];
  openingId: string | null;
  onOpen: OnOpen;
};

export function RemindersPreview({
  items,
  openingId,
  onOpen,
}: RemindersPreviewProps): ReactNode {
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

  const willGet = items.filter((item) => item.skip_reason === null);
  const skipped = items.filter((item) => item.skip_reason !== null);
  return (
    <div className="grid gap-6 @5xl:grid-cols-2 @5xl:items-start">
      <PreviewGroup
        title="Will get one"
        items={willGet}
        emptyText="Nobody this week."
        openingId={openingId}
        onOpen={onOpen}
      />
      <PreviewGroup
        title="Skipped"
        items={skipped}
        emptyText="Nobody is skipped this week."
        openingId={openingId}
        onOpen={onOpen}
      />
    </div>
  );
}

type PreviewGroupProps = {
  title: string;
  items: ReminderPreviewItem[];
  emptyText: string;
  openingId: string | null;
  onOpen: OnOpen;
};

function PreviewGroup({
  title,
  items,
  emptyText,
  openingId,
  onOpen,
}: PreviewGroupProps): ReactNode {
  return (
    <section className={cn(CARD, "overflow-hidden")}>
      <h3
        className={cn(
          EYEBROW,
          "border-b border-(--tl-border) bg-(--tl-surface-sunk) px-4 py-2.5 @2xl:px-5",
        )}
      >
        {title} <span className="tabular-nums">· {items.length}</span>
      </h3>
      {items.length === 0 ? (
        <p className="px-4 py-4 text-[14px] text-(--tl-muted)">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-(--tl-border)">
          {items.map((item) => (
            <PreviewRow
              key={item.guardian_id}
              item={item}
              isOpening={openingId === item.guardian_id}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type PreviewRowProps = {
  item: ReminderPreviewItem;
  isOpening: boolean;
  onOpen: OnOpen;
};

function PreviewRow({ item, isOpening, onOpen }: PreviewRowProps): ReactNode {
  const badge = item.skip_reason && (
    <Badge tone="neutral" icon={CircleAlert}>
      {SKIP_REASON_LABEL[item.skip_reason]}
    </Badge>
  );

  return (
    <li>
      <button
        type="button"
        aria-busy={isOpening || undefined}
        onClick={() => onOpen(item.guardian_id, item.guardian_name)}
        className="group flex min-h-[72px] w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-(--tl-tint) active:bg-(--tl-tint-strong) focus-visible:-outline-offset-2 @md:items-center @2xl:px-5"
      >
        <Avatar name={item.guardian_name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-6 font-semibold">
            {item.guardian_name}
          </span>
          <span className="block truncate text-[13px] leading-[18px] text-(--tl-muted)">
            {item.child_names.join(", ")} · {LANGUAGE_LABEL[item.language]}
          </span>
          {badge && <span className="mt-1.5 block @md:hidden">{badge}</span>}
        </span>
        {badge && <span className="hidden @md:block">{badge}</span>}
        {isOpening ? (
          <LoaderCircle
            aria-hidden
            className="kit-spin size-4 shrink-0 self-center text-(--tl-muted)"
          />
        ) : (
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 self-center text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
          />
        )}
      </button>
    </li>
  );
}
