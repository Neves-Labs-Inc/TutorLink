// Filter fields and state for the sample Bookings, Staff and Families
// lists, shared by those pages and the lists and header
// screens.
import {
  BOOKINGS,
  CHILDREN,
  GUARDIANS,
  STAFF,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type {
  Booking,
  Child,
  Guardian,
  Staff,
} from "@/pages/prototype/shell-kit/kit/mock-data";
import type { FilterOption } from "@/pages/prototype/shell-kit/kit/components/multi-select-filter";
import { useFilters } from "@/pages/prototype/shell-kit/kit/hooks/use-filters";

function getOptions<T>(rows: T[], read: (row: T) => string[]): FilterOption[] {
  const values = [...new Set(rows.flatMap(read))];
  return values.map((value) => ({
    value,
    label: value,
    count: rows.filter((row) => read(row).includes(value)).length,
  }));
}

export const BOOKING_FILTER_FIELDS = [
  { key: "kind", label: "Kind", options: getOptions(BOOKINGS, (b) => [b.kind]) },
  { key: "status", label: "Status", options: getOptions(BOOKINGS, (b) => [b.status]) },
  { key: "staff", label: "Staff", options: getOptions(BOOKINGS, (b) => [b.staff]) },
] as const;

export const STAFF_FILTER_FIELDS = [
  { key: "role", label: "Role", options: getOptions(STAFF, (s) => [s.role]) },
  {
    key: "signIn",
    label: "Sign-in",
    options: getOptions(STAFF, (s) => [s.isArchived ? "Archived" : s.signIn]),
  },
  { key: "subject", label: "Subject", options: getOptions(STAFF, (s) => s.subjects) },
] as const;

function getEvaluation(child: Child): string {
  return child.isEvaluated ? "Evaluated" : "Awaiting evaluation";
}

export const CHILD_FILTER_FIELDS = [
  { key: "evaluation", label: "Evaluation", options: getOptions(CHILDREN, (c) => [getEvaluation(c)]) },
  { key: "subject", label: "Subject level", options: getOptions(CHILDREN, (c) => c.subjects) },
] as const;

export const GUARDIAN_FILTER_FIELDS = [
  { key: "reminders", label: "Booking reminders", options: getOptions(GUARDIANS, (g) => [g.reminders]) },
  { key: "language", label: "Guardian language", options: getOptions(GUARDIANS, (g) => [g.language]) },
] as const;

type GuardianKey = (typeof GUARDIAN_FILTER_FIELDS)[number]["key"];
type ChildKey = (typeof CHILD_FILTER_FIELDS)[number]["key"];

type BookingKey = (typeof BOOKING_FILTER_FIELDS)[number]["key"];
type StaffKey = (typeof STAFF_FILTER_FIELDS)[number]["key"];

export function useBookingFilters(): ReturnType<typeof useFilters<BookingKey>> & {
  apply: (rows: Booking[]) => Booking[];
} {
  const filters = useFilters<BookingKey>({ kind: [], status: [], staff: [] });
  const apply = (rows: Booking[]): Booking[] =>
    rows.filter(
      (booking) =>
        filters.matches("kind", booking.kind) &&
        filters.matches("status", booking.status) &&
        filters.matches("staff", booking.staff),
    );
  return { ...filters, apply };
}

export function useStaffFilters(
  initial: Partial<Record<StaffKey, string[]>> = {},
): ReturnType<typeof useFilters<StaffKey>> & {
  apply: (rows: Staff[]) => Staff[];
} {
  const filters = useFilters<StaffKey>({
    role: [],
    signIn: [],
    subject: [],
    ...initial,
  });
  const apply = (rows: Staff[]): Staff[] =>
    rows.filter(
      (staff) =>
        filters.matches("role", staff.role) &&
        filters.matches("signIn", staff.isArchived ? "Archived" : staff.signIn) &&
        filters.matches("subject", staff.subjects),
    );
  return { ...filters, apply };
}

export function useChildFilters(): ReturnType<typeof useFilters<ChildKey>> & {
  apply: (rows: Child[]) => Child[];
} {
  const filters = useFilters<ChildKey>({ evaluation: [], subject: [] });
  const apply = (rows: Child[]): Child[] =>
    rows.filter(
      (child) =>
        filters.matches("evaluation", getEvaluation(child)) &&
        filters.matches("subject", child.subjects),
    );
  return { ...filters, apply };
}

export function useGuardianFilters(): ReturnType<
  typeof useFilters<GuardianKey>
> & {
  apply: (rows: Guardian[]) => Guardian[];
} {
  const filters = useFilters<GuardianKey>({ reminders: [], language: [] });
  const apply = (rows: Guardian[]): Guardian[] =>
    rows.filter(
      (guardian) =>
        filters.matches("reminders", guardian.reminders) &&
        filters.matches("language", guardian.language),
    );
  return { ...filters, apply };
}
