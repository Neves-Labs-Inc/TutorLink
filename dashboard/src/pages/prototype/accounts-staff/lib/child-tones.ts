// One kit pastel per Child in a family, in the family's Child order, so
// a week's Bookings tell the Children apart. Pink comes last because the
// kit already uses it for Evaluation.
import type { Tone } from "@/pages/prototype/shell-kit/kit/tokens";

export type ChildTone = Extract<Tone, "primary" | "green" | "yellow" | "pink">;

const CHILD_TONES: ChildTone[] = ["primary", "green", "yellow", "pink"];

export const DOT_CLASSES: Record<ChildTone, string> = {
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
};

export function getChildTones(childIds: string[]): Map<string, ChildTone> {
  return new Map(childIds.map((id, index) => [id, CHILD_TONES[index % CHILD_TONES.length]]));
}
