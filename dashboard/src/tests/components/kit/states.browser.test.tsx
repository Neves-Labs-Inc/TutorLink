import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { ErrorState } from "@/components/kit/states/states";

const renderError = (isBare: boolean) =>
  render(
    <ErrorState
      title="Chats didn’t load"
      body="Check your connection."
      onRetry={vi.fn()}
      isBare={isBare}
    />,
  );

describe("ErrorState", () => {
  it("draws the card by default", async () => {
    await renderError(false);
    const alert = page.getByRole("alert").element();
    expect(getComputedStyle(alert).borderRadius).toBe("20px");
  });

  it("drops the card when bare, keeping the alert and Try again", async () => {
    await renderError(true);
    const alert = page.getByRole("alert").element();
    expect(getComputedStyle(alert).borderRadius).toBe("0px");
    await expect
      .element(page.getByRole("button", { name: "Try again" }))
      .toBeVisible();
  });
});
