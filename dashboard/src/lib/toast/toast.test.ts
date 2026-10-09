import { describe, expect, it } from "vitest";

import { DEFAULT_TOAST_DURATION_MS, nextToasts, type ToastEntry } from "./toast";

function addMessages(messages: string[]): ToastEntry[] {
  return messages.reduce<ToastEntry[]>(
    (toasts, message) => nextToasts(toasts, { type: "add", message }),
    [],
  );
}

describe("nextToasts", () => {
  it("assigns every added toast a unique id", () => {
    const toasts = addMessages(["Saved.", "Saved.", "Saved."]);
    const ids = new Set(toasts.map((toast) => toast.id));

    expect(ids.size).toBe(3);
  });

  it("keeps at most three open, closing the oldest first so its exit can animate", () => {
    const toasts = addMessages(["one", "two", "three", "four"]);

    expect(toasts.map((toast) => [toast.message, toast.open])).toEqual([
      ["one", false],
      ["two", true],
      ["three", true],
      ["four", true],
    ]);
  });

  it("does not count a closing toast against the cap", () => {
    const [first, ...rest] = addMessages(["one", "two", "three"]);
    const closing = nextToasts([first, ...rest], { type: "close", id: first.id });
    const toasts = nextToasts(closing, { type: "add", message: "four" });

    expect(toasts.map((toast) => [toast.message, toast.open])).toEqual([
      ["one", false],
      ["two", true],
      ["three", true],
      ["four", true],
    ]);
  });

  it("closes a toast by id without removing it", () => {
    const toasts = addMessages(["one", "two"]);
    const closed = nextToasts(toasts, { type: "close", id: toasts[0].id });

    expect(closed.map((toast) => [toast.message, toast.open])).toEqual([
      ["one", false],
      ["two", true],
    ]);
  });

  it("dismisses a toast by id and leaves the rest in order", () => {
    const toasts = addMessages(["one", "two", "three"]);
    const remaining = nextToasts(toasts, { type: "dismiss", id: toasts[1].id });

    expect(remaining.map((toast) => toast.message)).toEqual(["one", "three"]);
  });

  it("defaults to a 5 s neutral toast and keeps an override", () => {
    const [byDefault] = nextToasts([], { type: "add", message: "Saved." });
    const [overridden] = nextToasts([], {
      type: "add",
      message: "Booking updated. Let the Guardian know.",
      tone: "success",
      durationMs: 8000,
    });

    expect(DEFAULT_TOAST_DURATION_MS).toBe(5000);
    expect(byDefault).toMatchObject({ tone: "neutral", durationMs: 5000 });
    expect(overridden).toMatchObject({ tone: "success", durationMs: 8000 });
  });
});
