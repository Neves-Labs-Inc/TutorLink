import { useState } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { Button } from "@/components/kit/components/button";

const DISABLED_OPACITY = "0.5";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function ToggleHarness(): ReactNode {
  const [isLoading, setIsLoading] = useState(false);
  return (
    <KitRoot theme="light" height="200px">
      <Button isLoading={isLoading} onClick={() => setIsLoading(true)}>
        Save
      </Button>
    </KitRoot>
  );
}

describe("Button while loading", () => {
  it("keeps keyboard focus after the button turns loading", async () => {
    await render(<ToggleHarness />);
    const button = page.getByRole("button", { name: "Save" });
    button.element().focus();
    await userEvent.keyboard("{Enter}");

    await expect.element(button).toHaveAttribute("aria-busy", "true");
    await nextFrame();
    await nextFrame();

    expect(document.activeElement).toBe(button.element());
  });

  it("is aria-disabled, not natively disabled", async () => {
    await render(
      <KitRoot theme="light" height="200px">
        <Button isLoading>Save</Button>
      </KitRoot>,
    );
    const button = page.getByRole("button", { name: "Save" });

    await expect.element(button).toHaveAttribute("aria-disabled", "true");
    await expect.element(button).toHaveAttribute("aria-busy", "true");
    await expect.element(button).not.toHaveAttribute("disabled");
  });

  it("ignores clicks and Enter and Space presses", async () => {
    const onClick = vi.fn();
    await render(
      <KitRoot theme="light" height="200px">
        <Button isLoading onClick={onClick}>
          Save
        </Button>
      </KitRoot>,
    );
    const button = page.getByRole("button", { name: "Save" });

    // Playwright treats aria-disabled as not actionable; force a real click anyway.
    await userEvent.click(button, { force: true });
    button.element().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");

    expect(onClick).not.toHaveBeenCalled();
  });

  it("does not submit its form", async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    await render(
      <KitRoot theme="light" height="200px">
        <form onSubmit={onSubmit}>
          <Button type="submit" isLoading>
            Save
          </Button>
        </form>
      </KitRoot>,
    );
    const button = page.getByRole("button", { name: "Save" });

    // Playwright treats aria-disabled as not actionable; force a real click anyway.
    await userEvent.click(button, { force: true });
    button.element().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("looks disabled: half opacity and a not-allowed cursor", async () => {
    await render(
      <KitRoot theme="light" height="200px">
        <Button isLoading>Save</Button>
      </KitRoot>,
    );
    const style = getComputedStyle(page.getByRole("button", { name: "Save" }).element());

    expect(style.opacity).toBe(DISABLED_OPACITY);
    expect(style.cursor).toBe("not-allowed");
  });

  it("does not tint on hover while loading", async () => {
    await render(
      <KitRoot theme="light" height="200px">
        <Button isLoading>Save</Button>
      </KitRoot>,
    );
    const button = page.getByRole("button", { name: "Save" });
    const restingBackground = getComputedStyle(button.element()).backgroundColor;

    await userEvent.hover(button, { force: true });

    expect(getComputedStyle(button.element()).backgroundColor).toBe(restingBackground);
  });

  it("stays natively disabled when disabled is set", async () => {
    await render(
      <KitRoot theme="light" height="200px">
        <Button disabled>Save</Button>
      </KitRoot>,
    );

    await expect.element(page.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("calls onClick when idle", async () => {
    const onClick = vi.fn();
    await render(
      <KitRoot theme="light" height="200px">
        <Button onClick={onClick}>Save</Button>
      </KitRoot>,
    );

    await userEvent.click(page.getByRole("button", { name: "Save" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("blocks Enter in a field from submitting through a form= Button while loading, and allows it once idle", async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    function Harness({ isLoading }: { isLoading: boolean }): ReactNode {
      return (
        <KitRoot theme="light" height="200px">
          <form id="outside-form" onSubmit={onSubmit}>
            <input aria-label="Name" />
          </form>
          <Button type="submit" form="outside-form" isLoading={isLoading}>
            Save
          </Button>
        </KitRoot>
      );
    }
    const screen = await render(<Harness isLoading />);
    page.getByLabelText("Name").element().focus();

    await userEvent.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();

    await screen.rerender(<Harness isLoading={false} />);
    page.getByLabelText("Name").element().focus();
    await userEvent.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
