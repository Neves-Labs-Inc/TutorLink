// One Guardian on the family page: a whole-card button opening their
// details. Name comes from the household; phone, language and the
// Reminders badge from their own details, which may still be loading.
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  ArchivedBadge,
  Avatar,
  RemindersBadge,
} from "@/components/kit/components/badges";
import { cn } from "@/components/kit/tokens";
import { Skeleton } from "@/components/kit/states/states";
import type { FamilyGuardian } from "@/hooks/use-family";
import {
  formatPhone,
  getLanguageLabel,
  getRemindersLabel,
} from "@/pages/families/lib/family-labels";
import {
  RECORD_CARD,
  RECORD_CARD_ARCHIVED,
  RECORD_CHEVRON,
} from "@/pages/families/lib/family-classes";

type GuardianRowProps = {
  guardian: FamilyGuardian;
  isNew: boolean;
  onOpen: () => void;
};

export default function GuardianRow({
  guardian,
  isNew,
  onOpen,
}: GuardianRowProps): ReactNode {
  const { detail } = guardian;
  const client = detail.data;
  // A retry puts the query back to pending; the failure stays up.
  const hasFailed = detail.isError || detail.errorUpdateCount > 0;

  let summary: ReactNode = <Skeleton className="mt-1 h-3 w-40 rounded-full" />;
  let badge: ReactNode = <Skeleton className="h-7 w-28 rounded-full" />;
  if (client) {
    summary = (
      <span className="block truncate text-[13px] text-(--tl-muted) tabular-nums">
        {formatPhone(client.phone_number)} · {getLanguageLabel(client.language)}
      </span>
    );
    badge = <RemindersBadge state={getRemindersLabel(client.reminders)} />;
  } else if (hasFailed) {
    summary = (
      <span className="block truncate text-[13px] text-(--tl-danger)">
        Couldn’t load details
      </span>
    );
    badge = null;
  }
  // The household already knows; no need to wait for the details.
  if (guardian.archived) badge = <ArchivedBadge />;

  return (
    <li className={cn(isNew && "kit-rise")}>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open Guardian details: ${guardian.name}`}
        className={cn(
          RECORD_CARD,
          "min-h-[72px]",
          guardian.archived && RECORD_CARD_ARCHIVED,
        )}
      >
        <Avatar name={guardian.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">
            {guardian.name}
          </span>
          {summary}
        </span>
        {badge && <span className="hidden @md:inline-flex">{badge}</span>}
        <ChevronRight aria-hidden className={RECORD_CHEVRON} />
      </button>
    </li>
  );
}
