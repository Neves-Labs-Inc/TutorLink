import type { ReactNode } from "react";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { useBookingOverlays } from "@/hooks/use-booking-overlays";
import type { ChildDetail } from "@/types/families";

type ChildBookButtonProps = { child: ChildDetail };

// Book evaluation until Evaluated, then New booking; either opens the
// Bookings form with the Child picked.
export default function ChildBookButton({ child }: ChildBookButtonProps): ReactNode {
  const { openNewBooking } = useBookingOverlays();
  const isEvaluated = child.evaluated !== null;
  return (
    <Button
      variant="primary"
      icon={CalendarPlus}
      isFullWidth
      onClick={() =>
        openNewBooking(
          isEvaluated
            ? { childId: child.id }
            : { kind: "evaluation", childId: child.id },
        )
      }
    >
      {isEvaluated ? "New booking" : "Book evaluation"}
    </Button>
  );
}
