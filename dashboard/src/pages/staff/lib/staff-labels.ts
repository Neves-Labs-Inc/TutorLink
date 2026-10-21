// Staff wire values in the words on screen (CONTEXT.md vocabulary).
import { BUSINESS_TIME_ZONE } from "@/components/kit/format";
import type { SignInState } from "@/components/kit/types/domain";
import type { SignInStateWire, StaffRead } from "@/lib/queries/staff";

const SIGN_IN_LABELS: Record<SignInStateWire, SignInState> = {
  not_invited: "Not invited",
  invited: "Invited",
  active: "Active",
};

export function getSignInLabel(state: SignInStateWire): SignInState {
  return SIGN_IN_LABELS[state];
}

const NO_SUBJECTS = "None yet";
const NOT_APPLICABLE = "—";

// Admins don't teach, so they have no Subjects to list.
export function getSubjectsText(staff: StaffRead): string {
  if (staff.role === "admin") return NOT_APPLICABLE;
  return staff.subjects.length > 0
    ? staff.subjects.map((subject) => subject.name).join(", ")
    : NO_SUBJECTS;
}

// "Oct 27", on the business's calendar.
function formatInviteDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });
}

export function getSignInSentence(staff: StaffRead, now: Date = new Date()): string {
  const expiresAt = staff.invite_expires_at;
  let sentence = "Invited";
  if (staff.sign_in_state === "active") {
    sentence = "Active: has chosen a password";
  } else if (staff.sign_in_state === "not_invited") {
    sentence = "Not invited: can’t sign in yet";
  } else if (expiresAt !== null && new Date(expiresAt) <= now) {
    sentence = `Invited. The Invite expired ${formatInviteDate(expiresAt)}; send it again.`;
  } else if (expiresAt !== null) {
    sentence = `Invited. The Invite lasts until ${formatInviteDate(expiresAt)}.`;
  }
  return sentence;
}

export type StaffTab =
  | "overview"
  | "availability"
  | "children"
  | "time-off"
  | "bookings";

export type StaffTabItem = { id: StaffTab; label: string };

const OVERVIEW: StaffTabItem = { id: "overview", label: "Overview" };
const AVAILABILITY: StaffTabItem = { id: "availability", label: "Availability" };
const CHILDREN: StaffTabItem = { id: "children", label: "Children" };
const TIME_OFF: StaffTabItem = { id: "time-off", label: "Time off" };
const BOOKINGS: StaffTabItem = { id: "bookings", label: "Bookings" };

// Availability and Children belong to a Tutor's or Manager's teaching
// profile; everyone else has Overview, Time off and Bookings.
export function getStaffTabs(staff: StaffRead): StaffTabItem[] {
  const isTeacher = staff.tutor_id !== null && staff.role !== "admin";
  return isTeacher
    ? [OVERVIEW, AVAILABILITY, CHILDREN, TIME_OFF, BOOKINGS]
    : [OVERVIEW, TIME_OFF, BOOKINGS];
}
