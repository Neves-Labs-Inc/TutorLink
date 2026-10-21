// A sheet's failure line (Families pattern), until the kit FormAlert
// lands; swap it in then.
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { SHEET_FAILURE } from "@/pages/families/lib/family-classes";

type SheetFailureLineProps = { message: string };

export default function SheetFailureLine({
  message,
}: SheetFailureLineProps): ReactNode {
  return (
    <p role="alert" className={SHEET_FAILURE}>
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {message}
    </p>
  );
}
