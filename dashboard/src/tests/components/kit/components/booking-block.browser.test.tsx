import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import BookingBlock from "@/components/kit/components/booking-block";
import type { BookingBlockDisplay } from "@/components/kit/components/booking-block";

const EMMA: BookingBlockDisplay = {
  time: "3:30 PM",
  name: "Emma",
  fullName: "Emma Souza",
  what: "Math",
  staffName: "Ana Souza",
  status: "confirmed",
  tone: "primary",
};

function renderBlock(
  block: BookingBlockDisplay,
  onOpen = vi.fn(),
  heightPx?: number,
) {
  return render(
    <KitRoot theme="light">
      <div className="w-64 p-4" style={{ height: heightPx ?? "auto" }}>
        <BookingBlock {...block} layout={heightPx ? "fill" : "stack"} heightPx={heightPx} onOpen={onOpen} />
      </div>
    </KitRoot>,
  );
}

describe("BookingBlock", () => {
  it("shows a cancelled block with the word Cancelled and a struck name", async () => {
    await renderBlock({ ...EMMA, status: "cancelled" });

    const block = page.getByRole("button", {
      name: "3:30 PM, Emma Souza, Math with Ana Souza, Cancelled",
    });
    await expect.element(block).toBeVisible();
    await expect.element(block.getByText("· Cancelled")).toBeVisible();
    const name = block.getByText("Emma", { exact: true }).element();
    expect(getComputedStyle(name).textDecorationLine).toBe("line-through");
  });

  it("names the reason in the label when the block needs attention", async () => {
    await renderBlock({ ...EMMA, reason: "not_completed" });

    await expect
      .element(
        page.getByRole("button", {
          name: "3:30 PM, Emma Souza, Math with Ana Souza, Confirmed, needs attention: Not marked",
        }),
      )
      .toBeVisible();
  });

  it("ignores the reason on a cancelled block", async () => {
    await renderBlock({ ...EMMA, status: "cancelled", reason: "not_completed" });

    await expect
      .element(
        page.getByRole("button", {
          name: "3:30 PM, Emma Souza, Math with Ana Souza, Cancelled",
        }),
      )
      .toBeVisible();
  });

  it("opens when clicked", async () => {
    const onOpen = vi.fn();
    await renderBlock(EMMA, onOpen);

    await page.getByRole("button", { name: /Emma Souza/ }).click();

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("drops the Subject and Staff lines in a short fill block", async () => {
    await renderBlock(EMMA, vi.fn(), 50);

    const block = page.getByRole("button", { name: /Emma Souza/ });
    await expect.element(block.getByText("Emma", { exact: true })).toBeVisible();
    await expect.element(block.getByText("Math")).not.toBeInTheDocument();
    await expect.element(block.getByText("Ana Souza")).not.toBeInTheDocument();
  });

  it("shows all four lines in a tall fill block", async () => {
    await renderBlock(EMMA, vi.fn(), 100);

    const block = page.getByRole("button", { name: /Emma Souza/ });
    await expect.element(block.getByText("Math")).toBeVisible();
    await expect.element(block.getByText("Ana Souza")).toBeVisible();
  });
});
