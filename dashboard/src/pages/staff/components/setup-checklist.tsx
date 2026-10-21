// "Finish setting up" at the top of a new Staff member's Overview: each
// step done or to do, with its act while it's still to do.
import type { ReactNode } from "react";
import { Check, Circle } from "lucide-react";
import { TextLink } from "@/components/kit/components/button";
import { Skeleton } from "@/components/kit/states/states";
import { CARD_TITLE, cn } from "@/components/kit/tokens";
import type {
  SetupChecklist as Checklist,
  SetupStepId,
} from "@/pages/staff/lib/setup-checklist";

type SetupChecklistProps = {
  checklist: Checklist;
  // The Invite's POST is running; its act waits.
  isInviting: boolean;
  onAct: (step: SetupStepId) => void;
};

export default function SetupChecklist({
  checklist,
  isInviting,
  onAct,
}: SetupChecklistProps): ReactNode {
  const { steps, doneCount } = checklist;
  return (
    <section
      aria-label="Finish setting up"
      className="mb-6 rounded-[20px] border border-(--tl-hero) bg-(--tl-tint) p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={CARD_TITLE}>Finish setting up</h3>
        <span className="shrink-0 text-[13px] font-semibold text-(--tl-primary-ink) tabular-nums">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-[16px] bg-(--tl-surface) px-3 py-2.5"
          >
            <span
              className={cn(
                "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full",
                step.isDone
                  ? "bg-(--tl-success-tint) text-(--tl-success)"
                  : "text-(--tl-muted)",
              )}
            >
              {step.isDone ? (
                <Check aria-hidden className="size-4" />
              ) : (
                <Circle aria-hidden className="size-4" />
              )}
            </span>
            <span className="min-w-0 flex-1 basis-32">
              <span
                className={cn(
                  "block text-[15px] leading-6 font-semibold [overflow-wrap:anywhere]",
                  step.isDone && "text-(--tl-muted) line-through",
                )}
              >
                {step.label}
                <span className="sr-only">
                  {step.isDone ? " (done)" : " (to do)"}
                </span>
              </span>
              {step.detail === null ? (
                <Skeleton className="mt-1.5 h-3 w-32" />
              ) : (
                <span className="block text-[13px] leading-[18px] text-(--tl-muted) [overflow-wrap:anywhere]">
                  {step.detail}
                </span>
              )}
            </span>
            {step.actLabel && (
              <TextLink
                onClick={() => onAct(step.id)}
                disabled={step.id === "invite" && isInviting}
                className="shrink-0 self-center disabled:cursor-not-allowed disabled:opacity-50"
              >
                {step.actLabel}
              </TextLink>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
