// One kit pastel per Child in a family, in the family's Child order, so
// a week's Bookings tell the Children apart. Pink comes last because the
// kit already uses it for Evaluation. From the fifth Child on, blocks are
// neutral and named by first name (no dot, so a legend lists the name only).
import type { Tone } from "@/components/kit/tokens";

export type ChildTone = Extract<Tone, "primary" | "green" | "yellow" | "pink" | "neutral">;
export type DottedChildTone = Exclude<ChildTone, "neutral">;

const COLOURED_TONES: DottedChildTone[] = ["primary", "green", "yellow", "pink"];

export const DOT_CLASSES: Record<DottedChildTone, string> = {
  primary: "bg-(--tl-primary)",
  green: "bg-(--tl-green-ink)",
  yellow: "bg-(--tl-yellow-ink)",
  pink: "bg-(--tl-pink-ink)",
};

export const BAR_CLASSES: Record<ChildTone, string> = {
  primary: "border-l-(--tl-primary)",
  green: "border-l-(--tl-green-ink)",
  yellow: "border-l-(--tl-yellow-ink)",
  pink: "border-l-(--tl-pink-ink)",
  neutral: "border-l-(--tl-border)",
};

export function getChildTones(childIds: string[]): Map<string, ChildTone> {
  return new Map(
    childIds.map((id, index) => [id, COLOURED_TONES[index] ?? "neutral"]),
  );
}
