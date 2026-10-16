// Badges never rely on colour alone: every status carries a dot or icon
// plus its word. Domain badges map CONTEXT.md states to one tone each.
import type { ReactNode } from "react";
import {
  BookOpen,
  Bot,
  Building2,
  CircleAlert,
  CircleSlash,
  Clock,
  Hourglass,
  Archive,
  Home,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn, TONE_CLASSES } from "@/components/kit/tokens";
import type { Tone } from "@/components/kit/tokens";
import { getInitials } from "@/components/kit/format";
import type {
  AttentionReason,
  BookingKind,
  BookingStatus,
  RemindersState,
  SignInState,
  SlotLocation,
  TimeOffStatus,
} from "@/components/kit/types/domain";

type BadgeProps = {
  tone: Tone;
  icon?: LucideIcon;
  hasDot?: boolean;
  children: ReactNode;
};

export function Badge({
  tone,
  icon: Icon,
  hasDot = false,
  children,
}: BadgeProps): ReactNode {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold whitespace-nowrap",
        TONE_CLASSES[tone],
      )}
    >
      {hasDot && (
        <span aria-hidden className="size-1.5 rounded-full bg-current" />
      )}
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {children}
    </span>
  );
}

type StatusStyle = { tone: Tone; label?: string; icon?: LucideIcon };

// Statuses with an icon drop the dot; `label` is the curly-apostrophe copy
// where it differs from the ASCII prop literal.
const BOOKING_STATUS_STYLE: Record<BookingStatus, StatusStyle> = {
  Pending: { tone: "warning" },
  Confirmed: { tone: "info" },
  Completed: { tone: "success" },
  Cancelled: { tone: "danger" },
  "Didn't happen": {
    tone: "neutral",
    label: "Didn’t happen",
    icon: CircleSlash,
  },
};

// The API sends lowercase values; the badge shows the capitalised label.
export type BookingStatusWire =
  "pending" | "confirmed" | "completed" | "cancelled" | "didnt_happen";

const BOOKING_STATUS_LABEL: Record<BookingStatusWire, BookingStatus> = {
  pending: "Pending",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
  didnt_happen: "Didn't happen",
};

function isBookingStatusWire(
  status: BookingStatus | BookingStatusWire,
): status is BookingStatusWire {
  return status in BOOKING_STATUS_LABEL;
}

export function BookingStatusBadge({
  status,
}: {
  status: BookingStatus | BookingStatusWire;
}): ReactNode {
  const label = isBookingStatusWire(status)
    ? BOOKING_STATUS_LABEL[status]
    : status;
  const style = BOOKING_STATUS_STYLE[label];
  return (
    <Badge tone={style.tone} icon={style.icon} hasDot={!style.icon}>
      {style.label ?? label}
    </Badge>
  );
}

const KIND_STYLE: Record<BookingKind, { tone: Tone; icon: LucideIcon }> = {
  Tutoring: { tone: "primary", icon: BookOpen },
  Evaluation: { tone: "pink", icon: Sparkles },
};

export type BookingKindWire = "regular" | "evaluation";

const KIND_LABEL: Record<BookingKindWire, BookingKind> = {
  regular: "Tutoring",
  evaluation: "Evaluation",
};

function isBookingKindWire(
  kind: BookingKind | BookingKindWire,
): kind is BookingKindWire {
  return kind in KIND_LABEL;
}

export function KindBadge({
  kind,
}: {
  kind: BookingKind | BookingKindWire;
}): ReactNode {
  const label = isBookingKindWire(kind) ? KIND_LABEL[kind] : kind;
  const style = KIND_STYLE[label];
  return (
    <Badge tone={style.tone} icon={style.icon}>
      {label}
    </Badge>
  );
}

const TIME_OFF_STYLE: Record<TimeOffStatus, StatusStyle> = {
  Pending: { tone: "warning" },
  Approved: { tone: "success" },
  Declined: { tone: "danger" },
  Cancelled: { tone: "neutral" },
  Expired: { tone: "neutral", icon: Hourglass },
};

export function TimeOffBadge({ status }: { status: TimeOffStatus }): ReactNode {
  const style = TIME_OFF_STYLE[status];
  return (
    <Badge tone={style.tone} icon={style.icon} hasDot={!style.icon}>
      {status}
    </Badge>
  );
}

type ChatHandlerBadgeProps = {
  handler: string;
  // The viewer is the Office member who took the chat over.
  isYou?: boolean;
};

// A chat is handled by the Bot, or Taken over by a named Office member.
export function ChatHandlerBadge({
  handler,
  isYou = false,
}: ChatHandlerBadgeProps): ReactNode {
  const isBot = handler === "Bot";
  const takenBy = isYou ? "you" : handler.split(" ")[0];
  return (
    <Badge tone={isBot ? "neutral" : "primary"} icon={isBot ? Bot : UserRound}>
      {isBot ? "Bot" : `Taken over by ${takenBy}`}
    </Badge>
  );
}

const BOT_PROBLEMS: AttentionReason[] = [
  "Bot got stuck",
  "Bot didn't understand",
];

// Office handoffs are routine (yellow); bot problems are faults (danger);
// a closed reply window is a warning with a clock.
export function AttentionBadge({
  reason,
}: {
  reason: AttentionReason;
}): ReactNode {
  if (reason === "Reply window closed") {
    return (
      <Badge tone="warning" icon={Clock}>
        {reason}
      </Badge>
    );
  }
  const isProblem = BOT_PROBLEMS.includes(reason);
  return (
    <Badge tone={isProblem ? "danger" : "yellow"} icon={CircleAlert}>
      {reason}
    </Badge>
  );
}

const SIGN_IN_TONE: Record<SignInState, Tone> = {
  "Not invited": "neutral",
  Invited: "warning",
  Active: "success",
};

export function SignInBadge({ state }: { state: SignInState }): ReactNode {
  return (
    <Badge tone={SIGN_IN_TONE[state]} hasDot>
      {state}
    </Badge>
  );
}

export function ArchivedBadge(): ReactNode {
  return (
    <Badge tone="neutral" icon={Archive}>
      Archived
    </Badge>
  );
}

export function EvaluatedBadge({
  isEvaluated,
}: {
  isEvaluated: boolean;
}): ReactNode {
  return isEvaluated ? (
    <Badge tone="success" hasDot>
      Evaluated
    </Badge>
  ) : (
    <Badge tone="pink" icon={Sparkles}>
      Awaiting evaluation
    </Badge>
  );
}

const REMINDERS_TONE: Record<RemindersState, Tone> = {
  "Reminders on": "success",
  "Reminders off": "neutral",
  "Never asked": "warning",
};

export function RemindersBadge({
  state,
}: {
  state: RemindersState;
}): ReactNode {
  return (
    <Badge tone={REMINDERS_TONE[state]} hasDot>
      {state}
    </Badge>
  );
}

const LOCATION_ICON: Record<SlotLocation, LucideIcon> = {
  "Home visits": Home,
  "Home or office": Home,
  "Office only": Building2,
};

export function SlotLocationBadge({
  location,
}: {
  location: SlotLocation;
}): ReactNode {
  return (
    <Badge tone="green" icon={LOCATION_ICON[location]}>
      {location}
    </Badge>
  );
}

type CountBadgeProps = {
  count: number;
  tone?: "primary" | "pink" | "quiet";
  label?: string;
};

// A number on nav items and tabs. `label` gives screen readers the noun.
export function CountBadge({
  count,
  tone = "primary",
  label,
}: CountBadgeProps): ReactNode {
  const toneClasses = {
    primary: "bg-(--tl-primary) text-(--tl-on-primary)",
    pink: "bg-(--tl-pink-tint) text-(--tl-pink-ink)",
    quiet: "bg-(--tl-surface-sunk) text-(--tl-muted)",
  };
  return (
    <span
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[12px] leading-none font-semibold tabular-nums",
        toneClasses[tone],
      )}
    >
      {count}
      {label && <span className="sr-only"> {label}</span>}
    </span>
  );
}

const AVATAR_CLASSES = [
  TONE_CLASSES.primary,
  TONE_CLASSES.pink,
  TONE_CLASSES.yellow,
  TONE_CLASSES.green,
];

function getAvatarClasses(name: string): string {
  const sum = [...name].reduce((total, char) => total + char.charCodeAt(0), 0);
  return AVATAR_CLASSES[sum % AVATAR_CLASSES.length];
}

const AVATAR_SIZES = {
  sm: "size-8 text-[12px]",
  md: "size-10 text-[13px]",
  lg: "size-12 text-[15px]",
};

type AvatarProps = { name: string; size?: keyof typeof AVATAR_SIZES };

export function Avatar({ name, size = "md" }: AvatarProps): ReactNode {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        AVATAR_SIZES[size],
        getAvatarClasses(name),
      )}
    >
      {getInitials(name)}
    </span>
  );
}
