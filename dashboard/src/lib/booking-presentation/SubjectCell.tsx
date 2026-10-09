import type { Booking } from "@/lib/queries/bookings";
import { EVALUATION_LABEL, MISSING_VALUE, subjectLabel } from "./bookingPresentation";

type SubjectCellProps = {
  booking: Pick<Booking, "kind" | "subject">;
  // `em` is for the lists that mix kinds (Bookings, My Sessions, the calendar); every other
  // surface shows the dash, per DESIGN.md §6.
  emptyAs: "em" | "dash";
};

export default function SubjectCell({ booking, emptyAs }: SubjectCellProps): React.ReactNode {
  const label = subjectLabel(booking);
  if (label.kind === "subject") return label.name;

  return emptyAs === "em" ? <em>{EVALUATION_LABEL}</em> : MISSING_VALUE;
}
