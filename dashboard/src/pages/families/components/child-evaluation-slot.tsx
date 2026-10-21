// Where Child details shows Subject levels, Evaluated and Assigned
// Tutors, between the Child notes and the Guardians. Ticket 07 fills it
// from `child`; until then it renders nothing.
import type { ReactNode } from "react";
import type { ChildDetail } from "@/types/families";

type ChildEvaluationSlotProps = { child: ChildDetail };

export default function ChildEvaluationSlot(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- ticket 07 reads it
  _props: ChildEvaluationSlotProps,
): ReactNode {
  return null;
}
