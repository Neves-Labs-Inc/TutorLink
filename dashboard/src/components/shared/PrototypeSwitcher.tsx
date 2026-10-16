// Floating dev-only bar that drives a prototype through URL params:
// `variant` (arrows, plus ← / → keys), `theme`, `screen`, and any extra
// toggles. Each prototype passes its own lists; omit `variants` (or pass
// one or none) to hide the arrows.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Minimize2,
  Moon,
  SlidersHorizontal,
  Sun,
} from "lucide-react";

export type SwitcherOption = { id: string; label: string };

export type SwitcherToggle = {
  param: string;
  label: string;
  options: SwitcherOption[];
};

type PrototypeSwitcherProps = {
  variants?: SwitcherOption[];
  screens?: SwitcherOption[];
  toggles?: SwitcherToggle[];
  // "bottom" keeps page headers clear; it moves to the top on phones,
  // where the app's own tab bar owns the bottom edge.
  position?: "top" | "bottom";
};

const MANY_SCREENS = 4;
const BUTTON_CLASS =
  "flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/20";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select") || target.isContentEditable;
}

function getCurrent(options: SwitcherOption[], value: string | null): string {
  return options.find((option) => option.id === value)?.id ?? options[0]?.id ?? "";
}

export function PrototypeSwitcher({
  variants = [],
  screens = [],
  toggles = [],
  position = "top",
}: PrototypeSwitcherProps): ReactNode {
  const [params, setParams] = useSearchParams();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const hasVariants = variants.length > 1;
  const variantIndex = Math.max(
    0,
    variants.findIndex((variant) => variant.id === params.get("variant")),
  );
  const theme = params.get("theme") === "dark" ? "dark" : "light";
  const screen = getCurrent(screens, params.get("screen"));

  function update(key: string, value: string): void {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  function cycle(step: number): void {
    if (!hasVariants) return;
    const next = (variantIndex + step + variants.length) % variants.length;
    update("variant", variants[next].id);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  if (import.meta.env.PROD) return null;

  const edgeClass =
    position === "bottom" ? "top-3 sm:top-auto sm:bottom-3" : "top-3";

  if (isCollapsed) {
    return (
      <button
        type="button"
        aria-label="Show prototype controls"
        onClick={() => setIsCollapsed(false)}
        className={`fixed left-3 ${edgeClass} z-[9999] flex h-9 w-9 items-center justify-center rounded-full bg-neutral-950 text-white shadow-2xl ring-1 ring-white/30`}
      >
        <SlidersHorizontal size={16} />
      </button>
    );
  }

  const current = variants[variantIndex];
  return (
    <div
      className={`fixed inset-x-0 ${edgeClass} z-[9999] mx-auto flex w-fit max-w-[calc(100vw-24px)] flex-wrap items-center justify-center gap-2 rounded-[22px] bg-neutral-950 px-2 py-1.5 text-xs text-white shadow-2xl ring-1 ring-white/30`}
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      {hasVariants && current && (
        <>
          <button
            type="button"
            aria-label="Previous variant"
            className={BUTTON_CLASS}
            onClick={() => cycle(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[8.5rem] text-center font-semibold">
            {current.id} ({current.label})
          </span>
          <button
            type="button"
            aria-label="Next variant"
            className={BUTTON_CLASS}
            onClick={() => cycle(1)}
          >
            <ChevronRight size={16} />
          </button>
          <span className="h-4 w-px bg-white/30" />
        </>
      )}
      <button
        type="button"
        aria-label="Toggle theme"
        className={BUTTON_CLASS}
        onClick={() => update("theme", theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
      </button>
      {screens.length > 0 && <span className="h-4 w-px bg-white/30" />}
      {screens.length > MANY_SCREENS ? (
        <select
          aria-label="Screen"
          value={screen}
          onChange={(event) => update("screen", event.target.value)}
          className="h-7 rounded-full bg-white px-3 font-medium text-neutral-950"
        >
          {screens.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <OptionGroup
          options={screens}
          value={screen}
          onChange={(id) => update("screen", id)}
        />
      )}
      {toggles.map((toggle) => (
        <span key={toggle.param} className="flex items-center gap-2">
          <span className="h-4 w-px bg-white/30" />
          <span className="sr-only">{toggle.label}</span>
          <OptionGroup
            options={toggle.options}
            value={getCurrent(toggle.options, params.get(toggle.param))}
            onChange={(id) => update(toggle.param, id)}
          />
        </span>
      ))}
      <span className="h-4 w-px bg-white/30" />
      <button
        type="button"
        aria-label="Hide prototype controls"
        className={BUTTON_CLASS}
        onClick={() => setIsCollapsed(true)}
      >
        <Minimize2 size={14} />
      </button>
    </div>
  );
}

type OptionGroupProps = {
  options: SwitcherOption[];
  value: string;
  onChange: (id: string) => void;
};

function OptionGroup({ options, value, onChange }: OptionGroupProps): ReactNode {
  return (
    <div className="flex gap-0.5">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
          className={`rounded-full px-2.5 py-1 font-medium ${option.id === value ? "bg-white text-neutral-950" : "hover:bg-white/20"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
