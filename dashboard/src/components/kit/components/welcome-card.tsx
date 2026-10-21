// A role's one-time welcome on its landing page: an icon chip, a title,
// two or three lines of plain text and a Dismiss X. No links and no
// action button (help is inline only). Dismiss calls onDismiss at once,
// moves focus to the page's h1 so it never falls to the body, and fades
// the card out; it renders nothing after that, so the caller may keep it
// mounted for the fade to play.
import { useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { HeartHandshake, X } from "lucide-react";
import { CARD, CARD_TITLE, TONE_CLASSES, cn } from "@/components/kit/tokens";
import { IconButton } from "@/components/kit/components/button";
import { FADE } from "@/components/kit/overlays/use-enter-animation";
import { usePresence } from "@/components/kit/overlays/use-presence";

type WelcomeCardProps = {
  title: string;
  body: string;
  onDismiss: () => void;
};

// The kit-fade pace from kit.css.
const FADE_ENTER_MS = 180;

function focusPageHeading(from: HTMLElement): void {
  const heading = from.closest("[data-kit]")?.querySelector("h1");
  if (!heading) return;
  if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

export function WelcomeCard({ title, body, onDismiss }: WelcomeCardProps): ReactNode {
  const [isShown, setIsShown] = useState(true);
  const cardRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const isPresent = usePresence(isShown, cardRef, FADE, { enterMs: FADE_ENTER_MS });

  function handleDismiss(): void {
    if (cardRef.current) focusPageHeading(cardRef.current);
    setIsShown(false);
    onDismiss();
  }

  if (!isPresent) return null;
  const isLeaving = !isShown;

  return (
    <section
      ref={cardRef}
      aria-labelledby={titleId}
      inert={isLeaving}
      className={cn(
        CARD,
        "grid grid-cols-[40px_minmax(0,1fr)_auto] gap-3 p-4 @2xl:p-5",
        isLeaving && "pointer-events-none",
      )}
    >
      <span
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-[14px]",
          TONE_CLASSES.primary,
        )}
      >
        <HeartHandshake aria-hidden className="size-[18px]" />
      </span>
      <div className="min-w-0">
        <h2 id={titleId} className={CARD_TITLE}>
          {title}
        </h2>
        <p className="mt-1 max-w-[64ch] text-[15px] leading-6 text-(--tl-ink-soft)">{body}</p>
      </div>
      {/* Pulled into the corner so the 44px target adds no height. */}
      <IconButton
        icon={X}
        label="Dismiss welcome"
        onClick={handleDismiss}
        className="-mt-2 -mr-2"
      />
    </section>
  );
}
