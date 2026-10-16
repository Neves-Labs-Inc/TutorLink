// The auth frame ("Brand panel", variant B): a light-blue panel carrying the real logo and
// the site's voice beside an open form. On phone the panel becomes a
// short band on top. Closest to the public website.
import type { ReactNode } from "react";
import LogoMedallion from "@/pages/prototype/auth/components/logo-medallion";
import AuthHeading from "@/pages/prototype/auth/components/layout/auth-heading";
import type { AuthPageContent } from "@/pages/prototype/auth/lib/auth-page-content";

export default function SplitLayout({
  icon,
  iconTone,
  title,
  body,
  children,
  footer,
  notes,
}: AuthPageContent): ReactNode {
  return (
    <main className="flex min-h-full flex-col @5xl:flex-row @5xl:gap-4 @5xl:p-4">
      <aside className="flex items-center gap-4 rounded-b-[28px] bg-[linear-gradient(160deg,var(--tl-hero),var(--tl-tint))] px-5 pt-6 pb-6 text-(--tl-primary-ink) in-data-[theme=dark]:bg-[linear-gradient(160deg,var(--tl-tint-strong),var(--tl-surface))] in-data-[theme=dark]:text-(--tl-ink) @5xl:sticky @5xl:top-4 @5xl:h-[calc(var(--kit-h)-32px)] @5xl:w-[44%] @5xl:max-w-[600px] @5xl:flex-col @5xl:justify-center @5xl:gap-8 @5xl:rounded-[28px] @5xl:px-12 @5xl:text-center">
        <LogoMedallion className="size-[72px] @5xl:size-[208px]" />
        <div className="flex min-w-0 flex-col gap-1 @5xl:items-center @5xl:gap-3">
          <p className="kit-display text-[15px] leading-5 font-light tracking-[0.06em] uppercase @5xl:hidden">
            M&rsquo;s Helping Hands
          </p>
          <p className="kit-display hidden text-[34px] leading-[42px] font-light @5xl:block">
            Every child learns differently.
          </p>
          <p className="text-[13px] leading-[18px] font-medium opacity-80 @5xl:text-[14px] @5xl:leading-5">
            TutorLink, for the office and our tutors
          </p>
        </div>
      </aside>
      <section className="flex flex-1 justify-center px-4 pt-8 pb-24 @5xl:items-center @5xl:px-10 @5xl:py-12">
        <div className="w-full max-w-[400px]">
          <AuthHeading icon={icon} iconTone={iconTone} title={title} body={body} isLarge />
          {children && <div className="mt-7">{children}</div>}
          {footer && (
            <div className="mt-6 flex flex-col items-start gap-1 border-t border-(--tl-border) pt-4 text-[14px] leading-5 text-(--tl-muted)">
              {footer}
            </div>
          )}
          {notes && <div className="mt-8 flex flex-col gap-2">{notes}</div>}
        </div>
      </section>
    </main>
  );
}
