// screen=badges: every status and kind in CONTEXT.md, plus counts and
// avatars. Each pairs a word with a dot or icon; colour is never alone.
import type { ReactNode } from "react";
import {
  ArchivedBadge,
  AttentionBadge,
  Avatar,
  BookingStatusBadge,
  ChatHandlerBadge,
  CountBadge,
  EvaluatedBadge,
  KindBadge,
  RemindersBadge,
  SignInBadge,
  SlotLocationBadge,
  TimeOffBadge,
} from "@/pages/prototype/shell-kit/kit/components/badges";
import type {
  AttentionReason,
  BookingStatus,
  RemindersState,
  SignInState,
  SlotLocation,
  TimeOffStatus,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import { STAFF } from "@/pages/prototype/shell-kit/kit/mock-data";
import { Gallery, Specimen } from "@/pages/prototype/shell-kit/screens/gallery";

const BOOKING_STATUSES: BookingStatus[] = ["Pending", "Confirmed", "Completed", "Cancelled"];
const TIME_OFF_STATUSES: TimeOffStatus[] = ["Pending", "Approved", "Declined", "Cancelled"];
const SIGN_IN_STATES: SignInState[] = ["Not invited", "Invited", "Active"];
const REMINDER_STATES: RemindersState[] = ["Reminders on", "Reminders off", "Never asked"];
const SLOT_LOCATIONS: SlotLocation[] = ["Home visits", "Home or office", "Office only"];
const HANDOFFS: AttentionReason[] = ["Wants to book", "Has a question", "Link request", "Reactivation request"];
const BOT_PROBLEMS: AttentionReason[] = ["Bot got stuck", "Bot didn't understand"];

type RowProps = { label: string; children: ReactNode };

function Row({ label, children }: RowProps): ReactNode {
  return (
    <div className="flex flex-col gap-2 border-b border-(--tl-border) py-4 first:pt-0 last:border-b-0 last:pb-0 @3xl:flex-row @3xl:items-center @3xl:gap-6">
      <span className="w-48 shrink-0 text-[14px] font-semibold">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

export default function BadgesScreen(): ReactNode {
  return (
    <Gallery
      title="Badges"
      intro="One tone per meaning across the app: warning is “waiting on someone”, info is “live”, success is “done/on”, danger is “stopped or failed”, neutral is “off/none”. Pink always means Evaluation."
    >
      <Specimen title="Status">
        <Row label="Booking">
          {BOOKING_STATUSES.map((status) => (
            <BookingStatusBadge key={status} status={status} />
          ))}
        </Row>
        <Row label="Time off">
          {TIME_OFF_STATUSES.map((status) => (
            <TimeOffBadge key={status} status={status} />
          ))}
        </Row>
        <Row label="Staff sign-in">
          {SIGN_IN_STATES.map((state) => (
            <SignInBadge key={state} state={state} />
          ))}
          <ArchivedBadge />
        </Row>
        <Row label="Child">
          <EvaluatedBadge isEvaluated />
          <EvaluatedBadge isEvaluated={false} />
        </Row>
        <Row label="Guardian">
          {REMINDER_STATES.map((state) => (
            <RemindersBadge key={state} state={state} />
          ))}
        </Row>
      </Specimen>
      <Specimen title="Kind and place">
        <Row label="Booking kind">
          <KindBadge kind="Tutoring" />
          <KindBadge kind="Evaluation" />
        </Row>
        <Row label="Availability slot">
          {SLOT_LOCATIONS.map((location) => (
            <SlotLocationBadge key={location} location={location} />
          ))}
        </Row>
      </Specimen>
      <Specimen
        title="Chats"
        note="Office handoffs are routine work (yellow). Bot problems are faults (red)."
      >
        <Row label="Handled by">
          <ChatHandlerBadge handler="Bot" />
          <ChatHandlerBadge handler="Maria Lopez" />
        </Row>
        <Row label="Needs attention: handoff">
          {HANDOFFS.map((reason) => (
            <AttentionBadge key={reason} reason={reason} />
          ))}
        </Row>
        <Row label="Needs attention: bot problem">
          {BOT_PROBLEMS.map((reason) => (
            <AttentionBadge key={reason} reason={reason} />
          ))}
        </Row>
      </Specimen>
      <Specimen
        title="Counts"
        note="Pink counts what waits on you (To do). Blue counts unread. Grey counts inactive tabs."
      >
        <Row label="Nav and tabs">
          <CountBadge count={9} tone="pink" label="to do" />
          <CountBadge count={3} label="unread" />
          <CountBadge count={7} tone="quiet" />
          <CountBadge count={128} tone="quiet" />
        </Row>
      </Specimen>
      <Specimen title="Avatars" note="Initials on the four brand pastels, picked from the name so a person keeps their colour.">
        <div className="flex flex-wrap items-center gap-3">
          {STAFF.slice(0, 6).map((staff) => (
            <Avatar key={staff.id} name={staff.name} />
          ))}
          <Avatar name="Maria Lopez" size="sm" />
          <Avatar name="Maria Lopez" size="lg" />
        </div>
      </Specimen>
    </Gallery>
  );
}
