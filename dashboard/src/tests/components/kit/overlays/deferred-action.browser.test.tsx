import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import {
  UNDO_WINDOW_MS,
  useDeferredAction,
} from "@/components/kit/overlays/use-deferred-action";
import type { DeferredActionInput } from "@/components/kit/overlays/use-deferred-action";
import { useAuthStore } from "@/stores/authStore";

const LATE_UNDO_MESSAGE = "Already done. It can’t be undone now.";
const LONG_AFTER_WINDOW_MS = UNDO_WINDOW_MS * 3;

type Act = {
  commit: ReturnType<typeof vi.fn<DeferredActionInput["commit"]>>;
  onUndo: ReturnType<typeof vi.fn<() => void>>;
  onCommitted: ReturnType<typeof vi.fn<() => void>>;
  onError: ReturnType<typeof vi.fn<(error: unknown) => void>>;
};

function createAct(
  commit: DeferredActionInput["commit"] = async () => undefined,
): Act {
  return {
    commit: vi.fn(commit),
    onUndo: vi.fn(),
    onCommitted: vi.fn(),
    onError: vi.fn(),
  };
}

type ConsumerProps = { acts: Record<string, Act> };

// One button per act; pressing it hides the button (the optimistic
// change) and defers the act. Undo brings the button back.
function Consumer({ acts }: ConsumerProps): ReactNode {
  const { defer } = useDeferredAction();
  const [hidden, setHidden] = useState<string[]>([]);
  return (
    <div>
      {Object.entries(acts)
        .filter(([name]) => !hidden.includes(name))
        .map(([name, act]) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              setHidden((current) => [...current, name]);
              defer({
                message: `Handed back ${name}.`,
                commit: act.commit,
                onUndo: () => {
                  act.onUndo();
                  setHidden((current) => current.filter((n) => n !== name));
                },
                onCommitted: act.onCommitted,
                errorMessage: `Couldn’t hand back ${name}. Try again.`,
                onError: act.onError,
              });
            }}
          >
            Hand back {name}
          </button>
        ))}
    </div>
  );
}

function renderConsumer(acts: Record<string, Act>) {
  return render(
    <KitRoot theme="light" height="600px">
      <Consumer acts={acts} />
    </KitRoot>,
  );
}

const handBack = (name: string) =>
  page.getByRole("button", { name: `Hand back ${name}` });
const undoFor = (name: string) =>
  page
    .getByRole("status")
    .filter({ hasText: `Handed back ${name}.` })
    .getByRole("button", { name: "Undo" });

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useDeferredAction", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    useAuthStore.setState({ accessToken: null });
    // Drops the own-property override so the prototype getter shows again.
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("commits once, at the end of the window, without keepalive", async () => {
    const act = createAct();
    await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));
    await expect.element(undoFor("Diana")).toBeVisible();

    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    expect(act.commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(act.commit).toHaveBeenCalledExactlyOnceWith({ keepalive: false });
    await expect.poll(() => act.onCommitted).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(act.commit).toHaveBeenCalledOnce();
  });

  it("restores and never commits when Undo is pressed", async () => {
    const act = createAct();
    await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));
    await expect.element(handBack("Diana")).not.toBeInTheDocument();

    await userEvent.click(undoFor("Diana"));

    expect(act.onUndo).toHaveBeenCalledOnce();
    await expect.element(handBack("Diana")).toBeVisible();
    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(act.commit).not.toHaveBeenCalled();
    // The restore is the feedback; no second toast.
    expect(page.getByRole("alert").elements()).toHaveLength(0);
    expect(page.getByText(LATE_UNDO_MESSAGE).elements()).toHaveLength(0);
  });

  it("commits at once with keepalive when the page hides", async () => {
    const act = createAct();
    await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));

    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    expect(act.commit).toHaveBeenCalledExactlyOnceWith({ keepalive: true });
    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(act.commit).toHaveBeenCalledOnce();
  });

  it("commits at once with keepalive when the tab turns hidden", async () => {
    const act = createAct();
    await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));

    setVisibility("visible");
    expect(act.commit).not.toHaveBeenCalled();
    setVisibility("hidden");

    expect(act.commit).toHaveBeenCalledExactlyOnceWith({ keepalive: true });
    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(act.commit).toHaveBeenCalledOnce();
  });

  it("commits pending acts with keepalive when the provider unmounts", async () => {
    useAuthStore.setState({ accessToken: "header.payload.signature" });
    const act = createAct();
    const screen = await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));

    await screen.unmount();

    expect(act.commit).toHaveBeenCalledExactlyOnceWith({ keepalive: true });
    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(act.commit).toHaveBeenCalledOnce();
  });

  it("drops pending acts when the provider unmounts after sign-out", async () => {
    const act = createAct();
    const screen = await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));

    // Signed out: an anonymous send would 401 into a session refresh.
    useAuthStore.setState({ accessToken: null });
    await screen.unmount();

    vi.advanceTimersByTime(LONG_AFTER_WINDOW_MS);
    expect(act.commit).not.toHaveBeenCalled();
  });

  it("shows an error toast and reports the error when the commit fails", async () => {
    const failure = new Error("network down");
    const act = createAct(async () => {
      throw failure;
    });
    await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));

    vi.advanceTimersByTime(UNDO_WINDOW_MS);

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Couldn’t hand back Diana. Try again.");
    expect(act.onError).toHaveBeenCalledExactlyOnceWith(failure);
    expect(act.onCommitted).not.toHaveBeenCalled();
  });

  it("tells the person it is too late when Undo follows a flush", async () => {
    const act = createAct();
    await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));
    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    await userEvent.click(undoFor("Diana"));

    await expect
      .element(page.getByRole("status").filter({ hasText: LATE_UNDO_MESSAGE }))
      .toBeVisible();
    expect(act.onUndo).not.toHaveBeenCalled();
    expect(act.commit).toHaveBeenCalledOnce();
  });

  it("stays quiet on Undo after a flush whose commit failed", async () => {
    const act = createAct(async () => {
      throw new Error("network down");
    });
    await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    await expect.element(page.getByRole("alert")).toBeVisible();

    await userEvent.click(undoFor("Diana"));

    // Nothing was done, so "Already done" would be false.
    expect(page.getByText(LATE_UNDO_MESSAGE).elements()).toHaveLength(0);
    expect(act.onUndo).not.toHaveBeenCalled();
  });

  it("logs, not rejects, when a consumer callback throws", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const unhandled = vi.fn();
    window.addEventListener("unhandledrejection", unhandled);
    const act = createAct();
    act.onCommitted.mockImplementation(() => {
      throw new Error("consumer bug");
    });
    await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));

    vi.advanceTimersByTime(UNDO_WINDOW_MS);

    await expect.poll(() => consoleError).toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    // A throwing onCommitted is not a failed commit.
    expect(page.getByRole("alert").elements()).toHaveLength(0);
  });

  it("keeps two pending acts independent", async () => {
    const diana = createAct();
    const bruno = createAct();
    await renderConsumer({ Diana: diana, Bruno: bruno });
    await userEvent.click(handBack("Diana"));
    vi.advanceTimersByTime(UNDO_WINDOW_MS / 2);
    await userEvent.click(handBack("Bruno"));

    await userEvent.click(undoFor("Diana"));
    vi.advanceTimersByTime(UNDO_WINDOW_MS / 2);
    expect(bruno.commit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(UNDO_WINDOW_MS / 2);
    expect(bruno.commit).toHaveBeenCalledExactlyOnceWith({ keepalive: false });
    expect(diana.onUndo).toHaveBeenCalledOnce();
    expect(diana.commit).not.toHaveBeenCalled();
    expect(bruno.onUndo).not.toHaveBeenCalled();
  });

  it("does not hasten the act when the toast is dismissed", async () => {
    const act = createAct();
    await renderConsumer({ Diana: act });
    await userEvent.click(handBack("Diana"));

    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));

    expect(act.commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UNDO_WINDOW_MS);
    expect(act.commit).toHaveBeenCalledExactlyOnceWith({ keepalive: false });
  });

  it("keeps the Undo toast up for exactly the window", async () => {
    await renderConsumer({ Diana: createAct() });
    await userEvent.click(handBack("Diana"));

    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    await expect.element(undoFor("Diana")).toBeVisible();

    vi.advanceTimersByTime(1);
    await expect.element(undoFor("Diana")).not.toBeInTheDocument();
  });

  it("needs a KitRoot above it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(render(<Consumer acts={{}} />)).rejects.toThrow(
      "useDeferredAction needs a <KitRoot> above it",
    );
  });
});
