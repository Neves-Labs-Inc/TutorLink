// The family's Children as cards, and Add child. Ticket 03 fills this in;
// it is the only file 03 edits on the family page.
import type { ReactNode } from "react";
import type { Family } from "@/hooks/use-family";

type FamilyChildrenSectionProps = { family: Family };

// Empty until ticket 03, which reads the family from its props.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function FamilyChildrenSection(_props: FamilyChildrenSectionProps): ReactNode {
  return null;
}
