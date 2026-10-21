// Booking details' footer: what went wrong (if anything), then the acts
// that fit the Booking, primary first; or a line saying none do.
import type { ReactNode } from "react";
import {
  CalendarCheck,
  Check,
  CircleAlert,
  CircleSlash,
  Pencil,
  RotateCcw,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import type { ButtonVariant } from "@/components/kit/components/button";
import { cn } from "@/components/kit/tokens";
import type { ActFeedback } from "@/hooks/use-booking-details";
import type { BookingAct, WriteAct } from "@/lib/bookings/booking-details";

type ActButton = { label: string; variant: ButtonVariant; icon: LucideIcon };

const ACT_BUTTONS: Record<BookingAct, ActButton> = {
  complete: { label: "Completed", variant: "primary", icon: Check },
  didnt_happen: { label: "Didn’t happen", variant: "outline", icon: CircleSlash },
  change: { label: "Change booking", variant: "primary", icon: Pencil },
  keep: { label: "Keep booking", variant: "outline", icon: CalendarCheck },
  cancel: { label: "Cancel booking", variant: "danger-outline", icon: X },
  reopen: { label: "Re-open", variant: "outline", icon: RotateCcw },
  restore: { label: "Restore", variant: "primary", icon: RotateCcw },
};

type BookingDetailsFooterProps = {
  acts: BookingAct[];
  statusWords: string;
  busyAct: WriteAct | null;
  feedback: ActFeedback | null;
  hasRestoreWarnings: boolean;
  onAct: (act: BookingAct) => void;
};

export default function BookingDetailsFooter({
  acts,
  statusWords,
  busyAct,
  feedback,
  hasRestoreWarnings,
  onAct,
}: BookingDetailsFooterProps): ReactNode {
  return (
    <div className="flex w-full flex-col gap-2">
      {feedback && (
        <p
          role="alert"
          className={cn(
            "kit-fade flex items-center gap-2 text-[13px] leading-[18px] font-semibold",
            feedback.tone === "danger"
              ? "text-(--tl-danger)"
              : "text-(--tl-warning)",
          )}
        >
          <CircleAlert aria-hidden className="size-4 shrink-0" />
          {feedback.message}
        </p>
      )}
      {acts.length === 0 ? (
        <p className="text-[13px] leading-[18px] text-(--tl-muted)">
          {statusWords} bookings can’t be changed.
        </p>
      ) : (
        <div className="flex flex-col gap-2 @md:flex-row">
          {acts.map((act) => {
            const { variant, icon } = ACT_BUTTONS[act];
            const label =
              act === "restore" && hasRestoreWarnings
                ? "Restore anyway"
                : ACT_BUTTONS[act].label;
            const isPressed = busyAct === act;
            return (
              <Button
                key={act}
                variant={variant}
                icon={icon}
                isFullWidth
                className="@md:flex-1"
                isLoading={isPressed}
                disabled={busyAct !== null && !isPressed}
                onClick={() => onAct(act)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      )}
    </div>
  );
}
