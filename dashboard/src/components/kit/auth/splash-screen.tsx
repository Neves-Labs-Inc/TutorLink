// What shows while the session is checked (the refresh call before any
// signed-in page renders). Logo only: no text, no spinner (DESIGN §12.1).
import type { ReactNode } from "react";
import LogoMedallion from "@/components/kit/auth/logo-medallion";

export default function SplashScreen(): ReactNode {
  return (
    <div
      role="status"
      aria-label="Checking your session"
      className="flex min-h-full items-center justify-center px-4 py-16"
    >
      {/* The delay keeps a fast session check from flashing the logo;
          reduced motion turns the animation, and so the delay, off. */}
      <div className="kit-fade [animation-delay:300ms]! [animation-fill-mode:both]!">
        <LogoMedallion className="size-[104px] @5xl:size-[128px]" />
      </div>
    </div>
  );
}
