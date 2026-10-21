// Guardians and Homes, side by side from 1024px. Ticket 04 fills this in;
// it is the only file 04 edits on the family page.
import type { ReactNode } from "react";
import type { Family } from "@/hooks/use-family";

type FamilyPeopleSectionProps = { family: Family };

// Empty until ticket 04, which reads the family from its props.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function FamilyPeopleSection(_props: FamilyPeopleSectionProps): ReactNode {
  return null;
}
