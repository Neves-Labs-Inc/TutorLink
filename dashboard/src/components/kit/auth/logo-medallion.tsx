// The brand's only logo (a JPEG on white) set in a white disc, so it
// reads the same on the light canvas, the blue panel and dark mode (the
// DESIGN §2.1 exception). Below ~48px the line art fails, so it is never
// shown smaller than 72px. Size it with classes (`size-[72px]`).
import type { ReactNode } from "react";
import logoUrl from "@/components/kit/auth/logo.jpg";
import { cn } from "@/components/kit/tokens";

const LOGO_PX = 768;

type LogoMedallionProps = { className: string };

export default function LogoMedallion({
  className,
}: LogoMedallionProps): ReactNode {
  return (
    <span
      className={cn(
        "kit-shadow-soft inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-(--tl-card-border)",
        className,
      )}
    >
      <img
        src={logoUrl}
        alt="M’s Helping Hands"
        width={LOGO_PX}
        height={LOGO_PX}
        className="size-full scale-[1.06] object-cover"
      />
    </span>
  );
}
