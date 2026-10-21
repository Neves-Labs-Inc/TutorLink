import type { ReactNode } from "react";
import { BellOff, BellRing, Settings } from "lucide-react";
import { Button, TextLink } from "@/components/kit/components/button";
import { CARD, CARD_TITLE, cn } from "@/components/kit/tokens";
import { formatDayAndTime } from "@/lib/chats/time";
import type { RemindersState } from "@/lib/reminders/reminders";

type StatusCopy = { title: string; body: string; action: string };

type RemindersStatusCardProps = {
  state: RemindersState;
  nextRunAt: string | null;
  canChangeSettings: boolean;
  onOpenSettings: () => void;
};

function getCopy(state: RemindersState, nextRunAt: string | null): StatusCopy {
  if (state === "on") {
    return {
      title: nextRunAt
        ? `Next Booking reminders: ${formatDayAndTime(nextRunAt)}`
        : "Booking reminders are on",
      body: "Sent weekly to Guardians with Reminders on and nothing booked for the week ahead.",
      action: "Change in Settings",
    };
  }
  if (state === "off") {
    return {
      title: "Booking reminders are off",
      body: "No Guardian gets a weekly reminder until they’re turned on.",
      action: "Turn on in Settings",
    };
  }
  return {
    title: "Booking reminders aren’t set up",
    body: "WhatsApp has to approve the reminder message before the first one can go out.",
    action: "Set up in Settings",
  };
}

export function RemindersStatusCard({
  state,
  nextRunAt,
  canChangeSettings,
  onOpenSettings,
}: RemindersStatusCardProps): ReactNode {
  const isOn = state === "on";
  const copy = getCopy(state, nextRunAt);
  const Icon = isOn ? BellRing : BellOff;

  return (
    <section
      className={cn(
        CARD,
        "flex flex-col gap-4 p-4 @2xl:flex-row @2xl:items-center @2xl:p-5",
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 @2xl:items-center">
        <span
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-[14px]",
            isOn
              ? "bg-(--tl-yellow-tint) text-(--tl-yellow-ink)"
              : "bg-(--tl-neutral-tint) text-(--tl-neutral)",
          )}
        >
          <Icon aria-hidden className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={CARD_TITLE}>{copy.title}</h2>
          <p className="text-[14px] leading-5 text-(--tl-muted)">{copy.body}</p>
          {!canChangeSettings && !isOn && (
            <p className="mt-1 text-[14px] leading-5 text-(--tl-ink-soft)">
              Only an Admin can change this.
            </p>
          )}
        </div>
      </div>
      {canChangeSettings &&
        (isOn ? (
          <TextLink onClick={onOpenSettings}>
            <Settings aria-hidden className="size-4" />
            {copy.action}
          </TextLink>
        ) : (
          <Button
            variant="primary"
            icon={Settings}
            onClick={onOpenSettings}
            className="w-full @2xl:w-auto"
          >
            {copy.action}
          </Button>
        ))}
    </section>
  );
}
