// A refused footer act: Take over, Take over from a colleague, a send.
import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";

type FooterAlertProps = { children: ReactNode };

export default function FooterAlert({ children }: FooterAlertProps): ReactNode {
  return (
    <p
      role="alert"
      className="kit-fade flex items-start gap-1.5 text-[13px] leading-5 font-medium text-(--tl-danger)"
    >
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}
