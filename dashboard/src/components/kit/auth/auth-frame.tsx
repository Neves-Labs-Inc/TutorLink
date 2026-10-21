// The auth frame ("Brand panel"): a light-blue panel carrying the logo and
// the site's voice beside an open form. Below @5xl the panel becomes a
// short band on top. The title is the page's only h1.
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import LogoMedallion from "@/components/kit/auth/logo-medallion";
import { Skeleton } from "@/components/kit/states/states";
import { TITLE, TONE_CLASSES, cn } from "@/components/kit/tokens";

type AuthTone = "primary" | "success" | "warning" | "danger";

const ICON_TITLE =
  "kit-display text-[30px] leading-[38px] font-light tracking-[-0.01em] @5xl:text-[34px] @5xl:leading-[42px]";

type AuthFrameProps = {
  icon?: LucideIcon;
  tone?: AuthTone;
  title: string;
  body?: ReactNode;
  children?: ReactNode;
  // Under the form: "Back to sign in", help lines.
  footer?: ReactNode;
};

type FrameShellProps = { children: ReactNode };

function FrameShell({ children }: FrameShellProps): ReactNode {
  return (
    <main className="flex min-h-full flex-col @5xl:flex-row @5xl:gap-4 @5xl:p-4">
      <aside className="flex items-center gap-4 rounded-b-[28px] bg-[linear-gradient(160deg,var(--tl-hero),var(--tl-tint))] px-5 py-6 text-(--tl-primary-ink) in-data-[theme=dark]:bg-[linear-gradient(160deg,var(--tl-tint-strong),var(--tl-surface))] in-data-[theme=dark]:text-(--tl-ink) @5xl:sticky @5xl:top-4 @5xl:h-[calc(var(--kit-h)-32px)] @5xl:w-[44%] @5xl:max-w-[600px] @5xl:flex-col @5xl:justify-center @5xl:gap-8 @5xl:rounded-[28px] @5xl:px-12 @5xl:text-center">
        <LogoMedallion className="size-[72px] @5xl:size-[208px]" />
        <div className="flex min-w-0 flex-col gap-1 @5xl:items-center @5xl:gap-3">
          <p className="kit-display text-[15px] leading-5 font-light tracking-[0.06em] uppercase @5xl:hidden">
            M&rsquo;s Helping Hands
          </p>
          <p className="kit-display hidden text-[34px] leading-[42px] font-light @5xl:block">
            Every child learns differently.
          </p>
          <p className="text-[13px] leading-[18px] font-medium @5xl:text-[14px] @5xl:leading-5">
            TutorLink, for the office and our tutors
          </p>
        </div>
      </aside>
      <section className="flex flex-1 justify-center px-4 pt-8 pb-24 @5xl:items-center @5xl:px-10 @5xl:py-12">
        {children}
      </section>
    </main>
  );
}

export function AuthFrame({
  icon: Icon,
  tone = "primary",
  title,
  body,
  children,
  footer,
}: AuthFrameProps): ReactNode {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownTitleRef = useRef(title);

  // A view swapped in place (Forgot -> Check your email) keeps the frame
  // mounted, so move focus to the new title; first mount never steals it.
  useEffect(() => {
    if (shownTitleRef.current !== title) {
      shownTitleRef.current = title;
      headingRef.current?.focus({ preventScroll: true });
    }
  }, [title]);

  return (
    <FrameShell>
      <div className="w-full max-w-[400px]">
        <header className="flex flex-col gap-2">
          {Icon && (
            <span
              aria-hidden
              className={cn(
                "mb-2 inline-flex size-12 items-center justify-center rounded-full",
                TONE_CLASSES[tone],
              )}
            >
              <Icon className="size-6" />
            </span>
          )}
          <h1
            ref={headingRef}
            tabIndex={-1}
            className={cn(
              Icon ? ICON_TITLE : TITLE,
              "text-(--tl-ink) outline-none",
            )}
          >
            {title}
          </h1>
          {body && (
            <div className="text-[15px] leading-6 text-(--tl-muted)">
              {body}
            </div>
          )}
        </header>
        {children && <div className="mt-7">{children}</div>}
        {footer && (
          <div className="mt-6 flex flex-col items-start gap-1 border-t border-(--tl-border) pt-4 text-[14px] leading-5 text-(--tl-muted)">
            {footer}
          </div>
        )}
      </div>
    </FrameShell>
  );
}

type AuthFrameSkeletonProps = { label: string };

// The frame with a form-shaped placeholder, shown while a link is checked.
export function AuthFrameSkeleton({
  label,
}: AuthFrameSkeletonProps): ReactNode {
  return (
    <FrameShell>
      <div
        role="status"
        aria-label={label}
        className="flex w-full max-w-[400px] flex-col gap-5"
      >
        <Skeleton className="h-9 w-64 max-w-full rounded-full" />
        <div className="flex flex-col gap-5">
          <Skeleton className="h-4 w-full rounded-full" />
          <Skeleton className="h-4 w-3/4 rounded-full" />
        </div>
        <div className="mt-2 flex flex-col gap-5">
          <Skeleton className="h-[52px] rounded-full" />
          {[0, 1].map((field) => (
            <div key={field} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-28 rounded-full" />
              <Skeleton className="h-11 rounded-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-11 rounded-full" />
      </div>
    </FrameShell>
  );
}
