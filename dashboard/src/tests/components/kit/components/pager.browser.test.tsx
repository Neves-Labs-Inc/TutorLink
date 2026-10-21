import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { page as browserPage, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { Pager } from "@/components/kit/components/pager";

const WIDE_WIDTH = 900;
const PHONE_WIDTH = 340;

type Options = {
  width?: number;
  page?: number;
  total?: number;
  isDisabled?: boolean;
};

async function renderPager({
  width = WIDE_WIDTH,
  page = 5,
  total = 400,
  isDisabled = false,
}: Options = {}) {
  const onPageChange = vi.fn();
  await render(
    <KitRoot theme="light">
      <div style={{ width }}>
        <Pager
          page={page}
          pageSize={20}
          total={total}
          onPageChange={onPageChange}
          label="Chats pages"
          isDisabled={isDisabled}
        />
      </div>
    </KitRoot>,
  );
  return onPageChange;
}

// innerText skips display:none, so it is what a sighted user reads.
function getLiveText(): string {
  return (document.querySelector("nav [aria-live]") as HTMLElement).innerText;
}

describe("Pager", () => {
  it("renders nothing when everything fits on one page", async () => {
    await renderPager({ page: 1, total: 20 });

    expect(document.querySelector("nav")).toBeNull();
  });

  it("shows the range of the current page", async () => {
    await renderPager({ page: 2, total: 312 });

    expect(getLiveText()).toBe("21–40 of 312");
  });

  it("clamps the range end to the total on the last page", async () => {
    await renderPager({ page: 16, total: 312 });

    expect(getLiveText()).toBe("301–312 of 312");
  });

  it("goes to the clicked page number", async () => {
    const onPageChange = await renderPager();

    await browserPage.getByRole("button", { name: "Page 6" }).click();

    expect(onPageChange).toHaveBeenCalledWith(6);
  });

  it("goes to the previous and next pages", async () => {
    const onPageChange = await renderPager();

    await browserPage.getByRole("button", { name: "Previous" }).click();
    await browserPage.getByRole("button", { name: "Next" }).click();

    expect(onPageChange).toHaveBeenNthCalledWith(1, 4);
    expect(onPageChange).toHaveBeenNthCalledWith(2, 6);
  });

  it("marks the current page and ignores clicks on it", async () => {
    const onPageChange = await renderPager();
    const current = browserPage.getByRole("button", { name: "Page 5" });

    await expect.element(current).toHaveAttribute("aria-current", "page");
    await current.click();

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("disables Previous on the first page and Next on the last", async () => {
    await renderPager({ page: 1 });
    await expect
      .element(browserPage.getByRole("button", { name: "Previous" }))
      .toBeDisabled();

    document.body.innerHTML = "";
    await renderPager({ page: 20 });
    await expect
      .element(browserPage.getByRole("button", { name: "Next" }))
      .toBeDisabled();
  });

  it("makes every control inert while a page loads", async () => {
    const onPageChange = await renderPager({ isDisabled: true });

    const buttons = document.querySelectorAll("nav button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(
        (button as HTMLButtonElement).disabled ||
          button.getAttribute("aria-disabled") === "true",
      ).toBe(true);
    }
    await browserPage
      .getByRole("button", { name: "Page 6" })
      .click({ force: true });
    await userEvent.keyboard("{Enter}");
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("keeps focus on the pressed number after the page changes", async () => {
    await renderControlled();
    const target = browserPage.getByRole("button", { name: "Page 6" });
    await userEvent.click(target);

    expect(document.activeElement?.getAttribute("aria-label")).toBe("Page 6");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Page 6");
  });

  it("shows arrows and Page N of M below 672px of its own width", async () => {
    const onPageChange = await renderPager({
      width: PHONE_WIDTH,
      page: 2,
      total: 312,
    });

    await expect.element(browserPage.getByText("Page 2 of 16")).toBeVisible();
    expect(
      browserPage.getByRole("button", { name: "Page 3" }).elements(),
    ).toHaveLength(0);
    for (const name of ["Previous", "Next"]) {
      expect(
        browserPage.getByRole("button", { name, exact: true }).elements(),
      ).toHaveLength(0);
    }
    await browserPage.getByRole("button", { name: "Next page" }).click();
    expect(onPageChange).toHaveBeenCalledWith(3);

    const nav = document.querySelector("nav") as HTMLElement;
    expect(nav.getBoundingClientRect().height).toBe(44);
    expect(nav.scrollWidth).toBeLessThanOrEqual(nav.clientWidth);
  });
});

describe("Pager past the last page", () => {
  it("stays visible and steps back to the real last page", async () => {
    const onPageChange = await renderPager({ page: 3, total: 20 });

    expect(getLiveText()).toBe("0 of 20");
    await browserPage.getByRole("button", { name: "Previous" }).click();

    expect(onPageChange).toHaveBeenCalledWith(1);
    await expect
      .element(browserPage.getByRole("button", { name: "Next" }))
      .toBeDisabled();
  });
});

function ControlledPager() {
  const [page, setPage] = useState(5);
  const [isLoading, setIsLoading] = useState(false);
  const handlePageChange = (next: number) => {
    setPage(next);
    setIsLoading(true);
    setTimeout(() => setIsLoading(false), 50);
  };
  return (
    <Pager
      page={page}
      pageSize={20}
      total={400}
      onPageChange={handlePageChange}
      label="Chats pages"
      isDisabled={isLoading}
    />
  );
}

async function renderControlled() {
  await render(
    <KitRoot theme="light">
      <div style={{ width: WIDE_WIDTH }}>
        <ControlledPager />
      </div>
    </KitRoot>,
  );
}
