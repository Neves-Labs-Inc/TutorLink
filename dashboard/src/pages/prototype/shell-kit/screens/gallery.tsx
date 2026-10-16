// Layout for the component screens: a plain page (no app nav) with
// titled specimen sections. Not part of the kit.
import type { ReactNode } from "react";
import { CARD, cn, EYEBROW, TITLE } from "@/pages/prototype/shell-kit/kit/tokens";
import { Wordmark } from "@/pages/prototype/shell-kit/kit/shell/wordmark";

type GalleryProps = { title: string; intro: string; children: ReactNode };

export function Gallery({ title, intro, children }: GalleryProps): ReactNode {
  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-16 pb-24 @xl:pt-10 @2xl:px-8">
      <Wordmark isCompact />
      <h1 className={cn(TITLE, "mt-8")}>{title}</h1>
      <p className="mt-2 max-w-[68ch] text-[15px] leading-6 text-(--tl-muted)">
        {intro}
      </p>
      <div className="mt-10 flex flex-col gap-8">{children}</div>
    </div>
  );
}

type SpecimenProps = {
  title: string;
  note?: string;
  isBare?: boolean;
  children: ReactNode;
};

export function Specimen({
  title,
  note,
  isBare = false,
  children,
}: SpecimenProps): ReactNode {
  return (
    <section aria-label={title}>
      <h2 className={EYEBROW}>{title}</h2>
      {note && (
        <p className="mt-1 max-w-[72ch] text-[14px] leading-5 text-(--tl-muted)">
          {note}
        </p>
      )}
      <div className={cn("mt-3", !isBare && cn(CARD, "p-5 @2xl:p-6"))}>
        {children}
      </div>
    </section>
  );
}

type PrototypeControlsProps = { label: string; children: ReactNode };

// Dashed so nobody mistakes it for product UI.
export function PrototypeControls({
  label,
  children,
}: PrototypeControlsProps): ReactNode {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-[20px] border-2 border-dashed border-(--tl-field-border) px-4 py-3">
      <span className="text-[13px] font-semibold text-(--tl-muted)">
        {label}
      </span>
      {children}
    </div>
  );
}
