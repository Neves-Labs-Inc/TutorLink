import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { renderWithProviders } from "@/test/render-with-providers";
import MessageItem from "@/pages/prototype/chats/components/message-item";
import { IntakeInProgressBadge } from "@/pages/prototype/chats/components/chat-badges";
import type { MessageRead } from "@/pages/prototype/chats/types/api";

const base: MessageRead = {
  id: "m1",
  author_kind: "bot",
  author: null,
  body: "Hello there",
  status: "sent",
  created_at: "2026-10-13T08:00:00-04:00",
  system_kind: null,
  error_code: null,
  reminder_child_names: null,
};

const renderItem = (message: MessageRead) =>
  renderWithProviders(
    <ul>
      <MessageItem message={message} meId="u1" onRetry={vi.fn()} canRetry />
    </ul>,
  );

describe("prototype MessageItem", () => {
  it("marks a failed bot reply Not sent with the error line and no Retry", async () => {
    await renderItem({ ...base, status: "failed", error_code: "131047" });

    await expect.element(page.getByText("Not sent", { exact: true })).toBeVisible();
    await expect.element(page.getByRole("note")).toBeVisible();
    expect(document.body.textContent).not.toContain("Retry");
  });

  it.each(["queued", "sent", "delivered"] as const)(
    "shows no delivery mark on a bot reply at %s",
    async (status) => {
      await renderItem({ ...base, status });

      await expect.element(page.getByText("Hello there")).toBeVisible();
      expect(document.body.textContent).not.toMatch(/Sending|Sent|Delivered|Not sent/);
    },
  );

  it("renders a handoff note as a Staff-only line, never failed, with no Retry", async () => {
    await renderItem({
      ...base,
      author_kind: "system",
      system_kind: "handoff_note",
      status: "failed",
      body: "Wants a trial lesson for Emma",
    });

    await expect.element(page.getByText("Bot’s handoff note")).toBeVisible();
    await expect.element(page.getByText("Wants a trial lesson for Emma")).toBeVisible();
    await expect.element(page.getByText("Only the office sees this.")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Retry|Not sent/);
  });
});

describe("IntakeInProgressBadge", () => {
  it("reads Intake in progress", async () => {
    await renderWithProviders(<IntakeInProgressBadge />);

    await expect.element(page.getByText("Intake in progress")).toBeVisible();
  });
});
