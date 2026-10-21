// The whole-form message above the footer: warnings to confirm, a
// refusal, or a stale save. It takes focus and scrolls into view when it
// appears, so the next step starts there.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/kit/components/button";
import { prefersReducedMotion } from "@/components/kit/overlays/use-enter-animation";
import { FormAlert } from "@/components/kit/states/states";
import type { BookingFormState } from "@/hooks/use-booking-form";

type BookingFormAlertProps = { form: BookingFormState };

export default function BookingFormAlert({
  form,
}: BookingFormAlertProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const verb = form.isChange ? "save" : "book";
  const hasWarnings = form.warnings.length > 0;
  const isShown = hasWarnings || form.refusal !== null || form.isStale;
  useEffect(() => {
    if (!isShown) return;
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "nearest",
    });
  }, [isShown, form.warnings, form.refusal]);
  if (!isShown) return null;

  let alert: ReactNode;
  if (form.isStale) {
    alert = (
      <FormAlert tone="warning" title="Someone else changed this booking">
        <p>Reload it to see their changes.</p>
        <Button
          variant="outline"
          icon={RotateCw}
          isLoading={form.isReloading}
          onClick={() => void form.reload()}
          className="mt-2"
        >
          Reload
        </Button>
      </FormAlert>
    );
  } else if (form.refusal) {
    alert = (
      <FormAlert tone="danger" title={form.refusal.title}>
        {form.refusal.body}
      </FormAlert>
    );
  } else {
    alert = (
      <FormAlert tone="warning" title={`Check before you ${verb}`}>
        <ul className="list-disc pl-5">
          {form.warnings.map((warning) => (
            <li key={warning.code}>{warning.message}</li>
          ))}
        </ul>
        <p className="mt-1 text-[13px]">
          {form.isChange ? "Save anyway" : "Book anyway"} if that’s intended.
        </p>
      </FormAlert>
    );
  }

  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      {alert}
    </div>
  );
}
