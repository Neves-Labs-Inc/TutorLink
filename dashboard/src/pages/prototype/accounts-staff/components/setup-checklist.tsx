// The setup checklist on new Staff details (#190): Subjects ·
// Availability · Invite, one page instead of the old trip across Users
// and Tutors. Admins get only Invite (no teaching profile). Hidden once
// everything is done.
import type { ReactNode } from "react";
import { Check, Circle } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { TextLink } from "@/components/kit/components/button";
import type { StaffPermissions } from "@/pages/prototype/accounts-staff/lib/staff-rules";
import type { StaffRead } from "@/pages/prototype/accounts-staff/types/api";

type Step = {
  id: string;
  label: string;
  detail: string;
  isDone: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

type SetupChecklistProps = {
  staff: StaffRead;
  slotCount: number;
  can: StaffPermissions;
  onAddSubjects: () => void;
  onOpenAvailability: () => void;
  onInvite: () => void;
};

export default function SetupChecklist({
  staff,
  slotCount,
  can,
  onAddSubjects,
  onOpenAvailability,
  onInvite,
}: SetupChecklistProps): ReactNode {
  const isTeacher = staff.tutor_id !== null;
  const teachingSteps: Step[] = isTeacher
    ? [
        {
          id: "subjects",
          label: "Subjects",
          detail: staff.subjects.length > 0 ? staff.subjects.map((s) => s.name).join(", ") : "What they teach, and up to which grade",
          isDone: staff.subjects.length > 0,
          actionLabel: can.canEditTeaching ? "Add subjects" : undefined,
          onAction: onAddSubjects,
        },
        {
          id: "availability",
          label: "Availability",
          detail: slotCount > 0 ? `${slotCount} time ranges a week` : "When Guardians can book them",
          isDone: slotCount > 0,
          actionLabel: can.canEditTeaching ? "Set availability" : undefined,
          onAction: onOpenAvailability,
        },
      ]
    : [];
  const steps: Step[] = [
    ...teachingSteps,
    {
      id: "invite",
      label: "Invite",
      detail: staff.sign_in_state === "not_invited" ? `An email to ${staff.email} to choose a password` : "Sent. They sign in once they choose a password.",
      isDone: staff.sign_in_state !== "not_invited",
      actionLabel: can.canInvite && staff.sign_in_state === "not_invited" ? "Send invite" : undefined,
      onAction: onInvite,
    },
  ];
  const doneCount = steps.filter((step) => step.isDone).length;
  if (doneCount === steps.length) return null;

  return (
    <section aria-label="Setup checklist" className="mb-6 rounded-[22px] border border-(--tl-hero) bg-(--tl-tint) p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="kit-display text-[17px] leading-6 font-bold">Finish setting up</h3>
        <span className="text-[13px] font-semibold text-(--tl-primary-ink) tabular-nums">
          {doneCount} of {steps.length} done
        </span>
      </div>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3 rounded-[16px] bg-(--tl-surface) px-3 py-2.5">
            <span
              className={cn(
                "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full",
                step.isDone ? "bg-(--tl-success-tint) text-(--tl-success)" : "text-(--tl-muted)",
              )}
            >
              {step.isDone ? <Check aria-hidden className="size-4" /> : <Circle aria-hidden className="size-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[15px] font-semibold", step.isDone && "text-(--tl-muted) line-through")}>
                {step.label}
                <span className="sr-only">{step.isDone ? " (done)" : " (to do)"}</span>
              </span>
              <span className="block text-[13px] leading-[18px] text-(--tl-muted)">{step.detail}</span>
            </span>
            {!step.isDone && step.actionLabel && step.onAction && (
              <TextLink onClick={step.onAction} className="shrink-0 self-center text-[14px]">
                {step.actionLabel}
              </TextLink>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
