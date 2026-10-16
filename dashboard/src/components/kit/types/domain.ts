// Domain words the kit renders (CONTEXT.md). Badges, the nav and the
// availability editor take these; callers map API data onto them.
export type Role = "admin" | "manager" | "tutor";

export type BookingKind = "Tutoring" | "Evaluation";
export type BookingStatus = "Pending" | "Confirmed" | "Completed" | "Cancelled";
export type TimeOffStatus = "Pending" | "Approved" | "Declined" | "Cancelled";
export type SignInState = "Not invited" | "Invited" | "Active";
export type AttentionReason =
  | "Wants to book"
  | "Has a question"
  | "Link request"
  | "Reactivation request"
  | "Bot got stuck"
  | "Bot didn't understand";
export type RemindersState = "Reminders on" | "Reminders off" | "Never asked";
export type SlotLocation = "Home visits" | "Home or office" | "Office only";

// Times are 24h "HH:MM", matching <input type="time">.
export type AvailabilitySlot = {
  id: string;
  day: string;
  from: string;
  to: string;
  location: SlotLocation;
};

// What the time helpers need from a booking: a naive business-local
// ISO start and a length.
export type TimedBooking = {
  start: string;
  durationMin: number;
};
