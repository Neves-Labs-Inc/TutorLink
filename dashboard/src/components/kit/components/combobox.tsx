// A searchable single-choice picker (ARIA combobox + listbox) for long
// lists like Staff or Children. Arrow keys move, Enter picks, Escape
// closes. Options can carry an avatar and a second line.
import { useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { Check, ChevronDown, CircleAlert } from "lucide-react";
import { cn } from "@/components/kit/tokens";
import { Avatar } from "@/components/kit/components/badges";
import {
  LIST_ENTER_MS,
  RISE,
} from "@/components/kit/overlays/use-enter-animation";
import { usePresence } from "@/components/kit/overlays/use-presence";

export type ComboboxOption = {
  value: string;
  label: string;
  description?: string;
  hasAvatar?: boolean;
};

type ComboboxProps = {
  label: string;
  options: ComboboxOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  help?: string;
  error?: string;
};

export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder = "Search",
  help,
  error,
}: ComboboxProps): ReactNode {
  const id = useId();
  const listId = `${id}-list`;
  const messageId = `${id}-message`;
  const selected = options.find((option) => option.value === value) ?? null;
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const isListPresent = usePresence(isOpen, listRef, RISE, {
    enterMs: LIST_ENTER_MS,
  });
  // Playing its exit: no id, so nothing points assistive tech into it.
  const isListLeaving = isListPresent && !isOpen;

  const needle = query.trim().toLowerCase();
  const matches = options.filter(
    (option) =>
      needle === "" ||
      option.label.toLowerCase().includes(needle) ||
      option.description?.toLowerCase().includes(needle),
  );
  const message = error ?? help;
  const activeOption = matches[activeIndex] ?? null;

  function pick(option: ComboboxOption): void {
    onChange(option.value);
    setQuery("");
    setIsOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((index) => Math.min(index + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && isOpen && activeOption) {
      event.preventDefault();
      pick(activeOption);
    } else if (event.key === "Escape" && isOpen) {
      // Marks the key handled, so the overlay around it stays open.
      event.preventDefault();
      setIsOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-[14px] leading-5 font-semibold text-(--tl-ink)"
      >
        {label}
      </label>
      <div className="relative">
        {selected?.hasAvatar && !isOpen && (
          <span className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2">
            <Avatar name={selected.label} size="sm" />
          </span>
        )}
        <input
          id={id}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            isOpen && activeOption ? `${listId}-${activeOption.value}` : undefined
          }
          aria-describedby={message ? messageId : undefined}
          aria-invalid={error ? true : undefined}
          value={isOpen ? query : (selected?.label ?? "")}
          placeholder={selected && isOpen ? selected.label : placeholder}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onClick={() => setIsOpen(true)}
          onBlur={() => setIsOpen(false)}
          onKeyDown={handleKeyDown}
          className={cn(
            "h-11 w-full rounded-full border bg-(--tl-surface) pr-11 text-[15px] text-(--tl-ink) placeholder:text-(--tl-muted)",
            selected?.hasAvatar && !isOpen ? "pl-12" : "pl-4",
            error
              ? "border-(--tl-danger)"
              : "border-(--tl-field-border) hover:border-(--tl-primary)",
          )}
        />
        <ChevronDown
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-1/2 right-4 size-[18px] -translate-y-1/2 text-(--tl-muted) transition-transform duration-150",
            isOpen && "rotate-180",
          )}
        />
        {isListPresent && (
          <ul
            ref={listRef}
            id={isListLeaving ? undefined : listId}
            role="listbox"
            aria-label={label}
            inert={isListLeaving}
            aria-hidden={isListLeaving || undefined}
            className={cn(
              "kit-shadow-raised absolute inset-x-0 top-[calc(100%+6px)] z-30 max-h-72 overflow-y-auto rounded-[20px] border border-(--tl-card-border) bg-(--tl-surface) p-1.5",
              isListLeaving && "pointer-events-none",
            )}
          >
            {matches.length === 0 && (
              <li className="px-3 py-3 text-[14px] text-(--tl-muted)">
                No matches for “{query}”.
              </li>
            )}
            {matches.map((option, index) => {
              const isSelected = option.value === value;
              const isActive = index === activeIndex;
              return (
                <li
                  key={option.value}
                  id={`${listId}-${option.value}`}
                  role="option"
                  aria-selected={isSelected}
                  // mousedown, not click: it fires before the input blurs.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(option);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-[14px] px-3 py-2",
                    isActive && "bg-(--tl-tint)",
                  )}
                >
                  {option.hasAvatar && <Avatar name={option.label} size="sm" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">
                      {option.label}
                    </span>
                    {option.description && (
                      <span className="block truncate text-[13px] text-(--tl-muted)">
                        {option.description}
                      </span>
                    )}
                  </span>
                  {isSelected && (
                    <Check
                      aria-hidden
                      className="size-[18px] shrink-0 text-(--tl-link)"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {message && (
        <p
          id={messageId}
          className={cn(
            "flex items-start gap-1.5 px-1 text-[13px] leading-[18px]",
            error ? "font-medium text-(--tl-danger)" : "text-(--tl-muted)",
          )}
        >
          {error && <CircleAlert aria-hidden className="mt-px size-4 shrink-0" />}
          {message}
        </p>
      )}
    </div>
  );
}
