import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";

const KIT_HEIGHT = "600px";
// Far below the fold, so the escaped box makes the root overflow.
const FAR_BELOW_PX = 3000;

// The page holds a top marker for the shell's position and a box with no
// positioned ancestor in the page, so it escapes to the kit root.
async function renderEscapedPage() {
  await render(
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <header data-testid="marker">Shell top</header>
      <div
        data-testid="escaped"
        style={{ position: "absolute", top: FAR_BELOW_PX }}
      >
        <button type="button">Hidden action</button>
      </div>
    </KitRoot>,
  );
  const root = document.querySelector<HTMLElement>("[data-kit]");
  const marker = document.querySelector<HTMLElement>('[data-testid="marker"]');
  const escaped = document.querySelector<HTMLElement>('[data-testid="escaped"]');
  if (!root || !marker || !escaped) throw new Error("page didn't render");
  return { root, marker, escaped };
}

describe("KitRoot", () => {
  it("clips its overflow instead of becoming a scroll container", async () => {
    const { root } = await renderEscapedPage();

    expect(window.getComputedStyle(root).overflow).toBe("clip");
  });

  it("keeps the shell in place when an escaped element is scrolled into view", async () => {
    const { root, marker, escaped } = await renderEscapedPage();
    const markerTop = marker.getBoundingClientRect().top;

    escaped.scrollIntoView();

    expect(root.scrollTop).toBe(0);
    expect(marker.getBoundingClientRect().top).toBe(markerTop);
  });

  it("keeps the shell in place when an element in an escaped box takes focus", async () => {
    const { root, marker, escaped } = await renderEscapedPage();
    const markerTop = marker.getBoundingClientRect().top;

    escaped.querySelector("button")?.focus();

    expect(root.scrollTop).toBe(0);
    expect(marker.getBoundingClientRect().top).toBe(markerTop);
  });
});
