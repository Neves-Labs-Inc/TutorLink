// The restore's 409 warnings, shown in place so "Restore anyway" can
// confirm them; scrolled into view when they arrive.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { prefersReducedMotion } from "@/components/kit/overlays/use-enter-animation";
import { FormAlert } from "@/components/kit/states/states";
import type { BookingWarning } from "@/lib/queries/bookings";

type RestoreWarningsProps = { warnings: BookingWarning[] };

export default function RestoreWarnings({
  warnings,
}: RestoreWarningsProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
    });
  }, [warnings]);

  return (
    <div ref={ref}>
      <FormAlert tone="warning" title="Check before you restore">
        <ul className="list-disc pl-5">
          {warnings.map((warning) => (
            <li key={warning.code}>{warning.message}</li>
          ))}
        </ul>
      </FormAlert>
    </div>
  );
}
