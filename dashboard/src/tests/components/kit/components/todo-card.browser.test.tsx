import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { MessageCircle } from "lucide-react";
import KitRoot from "@/components/kit/kit-root";
import TodoCard from "@/components/kit/components/todo-card";
import type { TodoPhase } from "@/components/kit/components/todo-card";

type RenderOptions = {
  phase: TodoPhase;
  total?: number;
  onRetry?: () => void;
  onSeeAll?: () => void;
  isRetrying?: boolean;
};

function renderCard({
  phase,
  total = 0,
  onRetry = vi.fn(),
  onSeeAll = vi.fn(),
  isRetrying,
}: RenderOptions) {
  return render(
    <KitRoot theme="light">
      <div className="p-4">
        <TodoCard
          id="chats"
          title="Chats"
          icon={MessageCircle}
          tone="primary"
          phase={phase}
          total={total}
          emptyHint="No chat needs attention."
          seeAllLabel="chats that need attention"
          onSeeAll={onSeeAll}
          onRetry={onRetry}
          isRetrying={isRetrying}
        >
          <li>Row one</li>
        </TodoCard>
      </div>
    </KitRoot>,
  );
}

describe("TodoCard", () => {
  it("shows three row skeletons while loading", async () => {
    await renderCard({ phase: "loading" });

    await expect
      .element(page.getByRole("status", { name: "Loading Chats" }))
      .toBeVisible();
    await expect.element(page.getByText("See all")).not.toBeInTheDocument();
  });

  it("explains the failure and retries from its own Try again", async () => {
    const onRetry = vi.fn();
    await renderCard({ phase: "error", onRetry });

    await expect
      .element(
        page.getByText("Couldn’t load chats. Check your connection and try again."),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("says Trying again while a retry runs", async () => {
    await renderCard({ phase: "error", isRetrying: true });

    await expect
      .element(page.getByRole("button", { name: "Trying again…" }))
      .toBeVisible();
  });

  it("says All clear with the hint when nothing is waiting", async () => {
    await renderCard({ phase: "ready", total: 0 });

    await expect.element(page.getByText("All clear")).toBeVisible();
    await expect.element(page.getByText("No chat needs attention.")).toBeVisible();
  });

  it("shows the rows and See all with the total when items are waiting", async () => {
    const onSeeAll = vi.fn();
    await renderCard({ phase: "ready", total: 7, onSeeAll });

    await expect.element(page.getByText("Row one")).toBeVisible();
    await page
      .getByRole("button", { name: "See all 7 chats that need attention" })
      .click();

    expect(onSeeAll).toHaveBeenCalledOnce();
  });

  it("shows Try again in the danger colour", async () => {
    await renderCard({ phase: "error" });

    const link = page.getByRole("button", { name: "Try again" }).element();
    const probe = document.createElement("span");
    probe.style.color = "var(--tl-danger)";
    link.parentElement?.appendChild(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();

    expect(getComputedStyle(link).color).toBe(expected);
  });
});
