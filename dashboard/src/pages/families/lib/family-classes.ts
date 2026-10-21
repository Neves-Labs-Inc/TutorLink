// Class sets every Families screen shares (tickets 02–09 import these
// rather than re-typing them). The kit's focus ring applies on its own.
import { CARD, cn } from "@/components/kit/tokens";

// A whole-card button: Child card, Guardian row, Child row in Guardian
// details. aria-label "Open {name}" ("Open Guardian details: {name}").
export const RECORD_CARD = cn(
  CARD,
  "group flex w-full cursor-pointer items-center gap-3 p-4 text-left transition-colors duration-150 hover:border-(--tl-hero) active:bg-(--tl-tint) @2xl:p-5",
);

// Added to RECORD_CARD for an archived record.
export const RECORD_CARD_ARCHIVED = "text-(--tl-muted)";

// The trailing ChevronRight on a RECORD_CARD.
export const RECORD_CHEVRON =
  "size-5 shrink-0 text-(--tl-muted) transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none";

// An eyebrow heading (EYEBROW: h2 on the page, h3 in an overlay) and an
// optional soft button; its id labels the <section>.
export const SECTION_HEAD = "mb-3 flex min-h-11 items-center justify-between gap-2";

// The empty line inside a section ("No Child notes yet").
export const SUNK_WELL =
  "rounded-[16px] bg-(--tl-surface-sunk) px-4 py-3 text-[14px] leading-5 text-(--tl-muted)";

// A sheet's failure line, last in its body above the footer. Stands in
// for the kit FormAlert (Settings/Auth 01) until it lands.
export const SHEET_FAILURE =
  "kit-fade flex items-start gap-2 rounded-[20px] bg-(--tl-danger-tint) px-4 py-3 text-[14px] leading-5 font-medium text-(--tl-danger)";

// The family page's sections, top to bottom.
export const FAMILY_SECTIONS = "flex flex-col gap-10";
