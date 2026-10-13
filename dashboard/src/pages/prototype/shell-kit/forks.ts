// The two forks Franklin settled on 2026-10-13 (A for both). Kept for
// the archive branch: pass `variants={FORKS[screen]}` to the switcher in
// shell-kit-prototype.tsx to bring the arrows back.
import type { SwitcherOption } from "@/components/shared/PrototypeSwitcher";

export const FORKS: Record<string, SwitcherOption[]> = {
  lists: [
    { id: "A", label: "Table + rows" },
    { id: "B", label: "Rich rows" },
  ],
  overlays: [
    { id: "A", label: "Pushed page" },
    { id: "B", label: "Bottom sheet" },
  ],
};
