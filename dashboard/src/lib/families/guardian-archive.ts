// What archiving a Guardian takes with it, worked out the way the API
// does (archive_service._set_guardian): when no other Guardian in the
// family is active, every live Child in the family is archived too and
// their upcoming Bookings are cancelled. The count goes back as
// `expected_cancellations`; a mismatch is a 409.
import { pluralize } from "@/components/kit/format";

export type CascadeFamily = {
  guardians: { id: string; archived: boolean }[];
  children: {
    id: string;
    name: string;
    archived: boolean;
    upcomingSessionCount: number;
  }[];
};

export type GuardianArchiveCascade = {
  children: { id: string; name: string }[];
  cancellations: number;
};

export function guardianArchiveCascade(
  family: CascadeFamily,
  guardianId: string,
): GuardianArchiveCascade {
  const guardian = family.guardians.find((member) => member.id === guardianId);
  const hasOtherActive = family.guardians.some(
    (member) => member.id !== guardianId && !member.archived,
  );
  if (!guardian || guardian.archived || hasOtherActive) {
    return { children: [], cancellations: 0 };
  }

  const orphans = family.children.filter((child) => !child.archived);
  return {
    children: orphans.map(({ id, name }) => ({ id, name })),
    cancellations: orphans.reduce(
      (total, child) => total + child.upcomingSessionCount,
      0,
    ),
  };
}

// "Sofia", "Sofia and Mateo", "Sofia, Mateo and Lucas".
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");

  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// The confirm's second paragraph, or null when nothing cascades.
export function describeCascade(cascade: GuardianArchiveCascade): string | null {
  const { children, cancellations } = cascade;
  if (children.length === 0) return null;

  const names = joinNames(children.map((child) => child.name));
  const verb = children.length === 1 ? "is" : "are";
  const bookings =
    cancellations === 0
      ? ". Restore won’t bring them back."
      : ` and their ${pluralize(cancellations, "upcoming Booking is", "upcoming Bookings are")} cancelled. Restore won’t bring those back.`;
  return `They’re the family’s last active Guardian, so ${names} ${verb} archived too${bookings}`;
}

// The toast after an archive, from what the API says it took.
export function describeArchived(
  name: string,
  childNames: string[],
  cancelled: number,
): string {
  let message = `${name} archived.`;
  if (childNames.length > 0) {
    const bookings =
      cancelled === 0
        ? ""
        : ` and ${pluralize(cancelled, "Booking", "Bookings")} cancelled`;
    message += ` ${joinNames(childNames)} archived${bookings}.`;
  }
  return message;
}
