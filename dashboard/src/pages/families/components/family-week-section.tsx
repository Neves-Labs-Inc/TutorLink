// Bookings by week for the whole family. Ticket 05 fills this in;
// it is the only file 05 edits on the family page.
import type { ReactNode } from "react";
import type { Family } from "@/hooks/use-family";

type FamilyWeekSectionProps = { family: Family };

// Empty until ticket 05, which reads the family from its props.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function FamilyWeekSection(_props: FamilyWeekSectionProps): ReactNode {
  return null;
}
