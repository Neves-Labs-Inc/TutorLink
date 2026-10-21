// Why a Booking (or a Child's missing Booking) needs attention: one label,
// icon and tone per reason. Lives apart from badges.tsx so that file only
// exports components.
import { Archive, ClipboardCheck, Plane, Sparkles, UserRoundX } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Tone } from "@/components/kit/tokens";

export type BookingReasonKey =
  | "not_completed"
  | "time_off_clash"
  | "archived_staff"
  | "needs_tutor"
  | "evaluation_to_book";

export type ReasonStyle = { label: string; icon: LucideIcon; tone: Tone };

// Every reason is a warning, except an Evaluation to book, which is pink.
export const BOOKING_REASON: Record<BookingReasonKey, ReasonStyle> = {
  not_completed: { label: "Not marked", icon: ClipboardCheck, tone: "warning" },
  time_off_clash: { label: "Staff is off", icon: Plane, tone: "warning" },
  archived_staff: { label: "Staff archived", icon: Archive, tone: "warning" },
  needs_tutor: { label: "Needs a Tutor", icon: UserRoundX, tone: "warning" },
  evaluation_to_book: {
    label: "Evaluation to book",
    icon: Sparkles,
    tone: "pink",
  },
};
