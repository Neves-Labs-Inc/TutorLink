// What shows while a reload checks the session (the refresh call before
// any signed-in page renders). Today RouteGuard shows a blank page.
import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import LogoMedallion from "@/pages/prototype/auth/components/logo-medallion";
import PrototypeNote from "@/pages/prototype/auth/components/prototype-note";

export default function SplashScreen(): ReactNode {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-6 px-4 py-16">
      <LogoMedallion className="size-[104px] @5xl:size-[128px]" />
      <p
        role="status"
        className="flex items-center gap-2 text-[14px] font-medium text-(--tl-muted)"
      >
        <LoaderCircle aria-hidden className="kit-spin size-[18px]" />
        Loading TutorLink…
      </p>
      <div className="mt-6 w-full max-w-[400px]">
        <PrototypeNote>
          Shown only if the check takes longer than ~300ms, so a quick reload
          never flashes it. The same logo as the sign-in panel, so a reload
          doesn&rsquo;t jump between looks.
        </PrototypeNote>
      </div>
    </main>
  );
}
