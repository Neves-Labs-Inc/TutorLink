import type {
  Booking,
  BookingLocation,
  StaffRef,
  StaffRole,
} from "@/lib/queries/bookings";

export type SubjectLabel = { kind: "subject"; name: string } | { kind: "evaluation" };

export const IN_OFFICE_LABEL = "In office";
export const HOME_LABEL = "Home";
export const EVALUATION_LABEL = "Evaluation";
export const MISSING_VALUE = "—";

const ROLE_LABELS: Record<StaffRole, string> = {
  tutor: "Tutor",
  manager: "Manager",
  admin: "Admin",
};

export function subjectLabel(booking: Pick<Booking, "kind" | "subject">): SubjectLabel {
  if (booking.kind === "evaluation" || booking.subject === null) {
    return { kind: "evaluation" };
  }

  return { kind: "subject", name: booking.subject.name };
}

// A list row carries `location` but no `home`, so it reads the generic "Home"; the detail,
// which loads the home, reads its label or, failing that, its address.
export function locationLabel(booking: {
  location: BookingLocation;
  home?: { label: string | null; address: string } | null;
}): string {
  if (booking.location === "in_office") return IN_OFFICE_LABEL;
  if (booking.home === undefined || booking.home === null) return HOME_LABEL;

  return booking.home.label ?? booking.home.address;
}

export function roleLabel(role: StaffRole): string {
  return ROLE_LABELS[role];
}

export function staffLabel(staff: StaffRef, withRole = false): string {
  return withRole ? `${staff.name} · ${roleLabel(staff.role)}` : staff.name;
}
