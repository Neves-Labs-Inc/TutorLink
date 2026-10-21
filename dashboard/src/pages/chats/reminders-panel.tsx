// Chats ▸ Reminders: the weekly Booking reminders run. A status card, a
// week stepper (the week lives in ?week=), then who the coming run will
// remind or what a past run did. A row opens the Guardian's chat.
import { useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, ChevronLeft, ChevronRight } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IconButton } from "@/components/kit/components/button";
import { useToast } from "@/components/kit/overlays/use-toast";
import {
  EmptyState,
  ErrorState,
  ListSkeleton,
  Skeleton,
} from "@/components/kit/states/states";
import { EYEBROW, HEADING } from "@/components/kit/tokens";
import { formatWeekLabel } from "@/lib/chats/time";
import { ADMIN_ROLES } from "@/lib/auth/auth";
import { guardianQueries } from "@/lib/queries/guardians";
import { reminderQueries } from "@/lib/queries/reminders";
import {
  isCurrentWeek,
  parseWeekParam,
  stepWeek,
} from "@/lib/reminders/reminders";
import { RemindersPreview } from "@/pages/chats/reminders-preview";
import { RemindersResults } from "@/pages/chats/reminders-results";
import { RemindersStatusCard } from "@/pages/chats/reminders-status-card";
import { useAuthStore } from "@/stores/authStore";

const WEEK_PARAM = "week";
const OFF_LINE = "Booking reminders are off, so no Guardian gets one.";
const NOT_SET_UP_LINE =
  "Booking reminders aren’t set up yet, so no Guardian gets one.";

export function RemindersPanel(): ReactNode {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const role = useAuthStore((state) => state.role);
  const [searchParams, setSearchParams] = useSearchParams();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const week = parseWeekParam(searchParams.get(WEEK_PARAM));
  const canChangeSettings = role !== null && ADMIN_ROLES.includes(role);

  // The default week's query carries the status card and the Later limit, and
  // is the shown week when there is no ?week=.
  const defaultQuery = useQuery(reminderQueries.week({ weekStart: null }));
  const chosenQuery = useQuery({
    ...reminderQueries.week({ weekStart: week }),
    enabled: week !== null,
  });
  const weekQuery = week === null ? defaultQuery : chosenQuery;
  const defaultWeek = defaultQuery.data?.week_start;
  const shownWeek = week ?? defaultWeek;

  function handleStep(direction: 1 | -1): void {
    if (shownWeek === undefined) return;
    const target = stepWeek(shownWeek, direction, defaultWeek);
    setSearchParams(target === null ? {} : { [WEEK_PARAM]: target });
  }

  function handleRetry(): void {
    if (defaultQuery.isError) void defaultQuery.refetch();
    if (week !== null && chosenQuery.isError) void chosenQuery.refetch();
  }

  async function handleOpenChat(guardianId: string, name: string): Promise<void> {
    if (openingId !== null) return;
    setOpeningId(guardianId);
    try {
      const guardian = await queryClient.fetchQuery({
        ...guardianQueries.detail(guardianId),
        staleTime: 0,
      });
      if (guardian.language_conversation_id) {
        navigate(`/chats/${guardian.language_conversation_id}`);
      } else {
        showToast({ tone: "info", message: `${name} has no chat yet.` });
      }
    } catch {
      showToast({
        tone: "error",
        message: `Couldn’t open ${name}’s chat. Try again.`,
      });
    } finally {
      setOpeningId(null);
    }
  }

  if (defaultQuery.isError || (week !== null && chosenQuery.isError)) {
    return (
      <ErrorState
        title="Couldn’t load reminders"
        body="Check your connection and try again."
        onRetry={handleRetry}
      />
    );
  }

  const status = defaultQuery.data;
  const data = weekQuery.data;
  const isStepping = weekQuery.isPending;
  // Only the default week can have a preview; anything else is a past run.
  const isPast =
    data !== undefined &&
    (data.has_run || data.preview === null);
  const isPastShown =
    data === undefined
      ? week !== null && defaultWeek !== undefined && week < defaultWeek
      : isPast;

  let content: ReactNode;
  if (data === undefined) {
    content = <ListSkeleton rows={4} label="Loading reminders" />;
  } else if (isPast) {
    content = (
      <RemindersResults
        key={data.week_start}
        weekStart={data.week_start}
        rows={data.rows}
        openingId={openingId}
        onOpen={handleOpenChat}
      />
    );
  } else if (data.reminders !== "on") {
    content = (
      <EmptyState
        icon={BellOff}
        tone="yellow"
        title="Nothing will go out this week"
        body={data.reminders === "off" ? OFF_LINE : NOT_SET_UP_LINE}
      />
    );
  } else {
    content = (
      <RemindersPreview
        items={data.preview ?? []}
        openingId={openingId}
        onOpen={handleOpenChat}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {status === undefined ? (
        <Skeleton className="h-[104px] w-full rounded-[20px]" />
      ) : (
        <RemindersStatusCard
          state={status.reminders}
          nextRunAt={status.next_run_at}
          canChangeSettings={canChangeSettings}
          onOpenSettings={() => navigate("/settings")}
        />
      )}
      <div className="flex items-center gap-2 @2xl:justify-start">
        <IconButton
          icon={ChevronLeft}
          label="Earlier week"
          variant="outline"
          disabled={isStepping || shownWeek === undefined}
          onClick={() => handleStep(-1)}
        />
        <div
          aria-live="polite"
          className="min-w-0 flex-1 text-center @2xl:flex-none @2xl:px-3 @2xl:text-left"
        >
          {shownWeek === undefined ? (
            <Skeleton className="mx-auto h-7 w-40 rounded-full @2xl:mx-0" />
          ) : (
            <>
              <p className={EYEBROW}>
                {isPastShown ? "Already sent" : "Coming up"}
              </p>
              <p className={HEADING}>{formatWeekLabel(shownWeek)}</p>
            </>
          )}
        </div>
        <IconButton
          icon={ChevronRight}
          label="Later week"
          variant="outline"
          disabled={isStepping || isCurrentWeek(week, defaultWeek)}
          onClick={() => handleStep(1)}
        />
      </div>
      {content}
    </div>
  );
}
