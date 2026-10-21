import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { ReplyWindowCue } from "@/components/kit/components/reply-window-cue";

const NOW = new Date("2026-10-19T14:00:00Z");
const HOUR = 3_600_000;

function atHoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR).toISOString();
}

describe("ReplyWindowCue", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the takeover closes while the bot holds the chat", async () => {
    await render(
      <KitRoot theme="light">
        <ReplyWindowCue lastClientMessageAt={atHoursAgo(19)} isTakenOverByYou={false} />
      </KitRoot>,
    );
    const cue = page.getByText("Takeover closes in 5h");
    await expect.element(cue).toBeVisible();
    await expect.element(cue).toHaveClass("text-(--tl-muted)");
  });

  it("says replies close once you hold the chat", async () => {
    await render(
      <KitRoot theme="light">
        <ReplyWindowCue lastClientMessageAt={atHoursAgo(19)} isTakenOverByYou />
      </KitRoot>,
    );
    await expect.element(page.getByText("Replies close in 5h")).toBeVisible();
  });

  it("turns warning and semibold under 3 hours", async () => {
    await render(
      <KitRoot theme="light">
        <ReplyWindowCue lastClientMessageAt={atHoursAgo(22)} isTakenOverByYou />
      </KitRoot>,
    );
    const cue = page.getByText("Replies close in 2h");
    await expect.element(cue).toHaveClass("text-(--tl-warning)");
    await expect.element(cue).toHaveClass("font-semibold");
  });

  it("points outside the bot once the window is closed", async () => {
    await render(
      <KitRoot theme="light">
        <ReplyWindowCue lastClientMessageAt={atHoursAgo(25)} isTakenOverByYou={false} />
      </KitRoot>,
    );
    const cue = page.getByText("Reply outside the bot");
    await expect.element(cue).toHaveClass("text-(--tl-danger)");
  });

  it("treats no client message as closed", async () => {
    await render(
      <KitRoot theme="light">
        <ReplyWindowCue lastClientMessageAt={null} isTakenOverByYou={false} />
      </KitRoot>,
    );
    await expect.element(page.getByText("Reply outside the bot")).toBeVisible();
  });

  it("updates as time advances", async () => {
    await render(
      <KitRoot theme="light">
        <ReplyWindowCue lastClientMessageAt={atHoursAgo(19)} isTakenOverByYou={false} />
      </KitRoot>,
    );
    await expect.element(page.getByText("Takeover closes in 5h")).toBeVisible();
    vi.advanceTimersByTime(2 * HOUR + 60_000);
    await expect.element(page.getByText("Takeover closes in 2h")).toBeVisible();
  });
});
