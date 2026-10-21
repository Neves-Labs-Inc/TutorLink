import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { InfoTip } from "@/components/kit/components/info-tip";
import { Dialog } from "@/components/kit/overlays/dialog";
import type { Theme } from "@/components/kit/tokens";

const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 390;
const NARROW_WIDTH = 320;
const VIEWPORT_HEIGHT = 800;
const KIT_HEIGHT = "600px";
const TARGET_PX = 44;
const BUBBLE_MAX_PX = 280;
const KIT_EDGE_INSET_PX = 16;
const MIN_TEXT_PX = 12;
const RISE_MS = 220;
const EXIT_MS = 160;
const THEMES: Theme[] = ["light", "dark"];
const EXPLANATION =
  "The bot offers times on a grid of this length. Shorter lengths give Guardians more choices.";

type HarnessProps = {
  theme?: Theme;
  // Pushes the tip to the right edge of the row, where the bubble would overflow.
  isAtRightEdge?: boolean;
};

function Harness({ theme = "light", isAtRightEdge = false }: HarnessProps): ReactNode {
  return (
    <KitRoot theme={theme} height={KIT_HEIGHT}>
      <div className="flex flex-col items-start gap-6 p-4">
        <div
          data-testid="label-row"
          className={isAtRightEdge ? "flex items-center justify-end" : "flex items-center"}
        >
          <span className="text-[14px] leading-5 font-semibold">Session length</span>
          <InfoTip label="About Session length">{EXPLANATION}</InfoTip>
        </div>
        {/* Clear of the first tip's open bubble. */}
        <div className="mt-24 flex items-center">
          <span>Reminder time</span>
          <InfoTip label="About Reminder time">Sent the day before.</InfoTip>
        </div>
        <button type="button">Elsewhere</button>
        <p>Outside text</p>
      </div>
    </KitRoot>
  );
}

// A tip inside a kit Dialog, whose panel is focusable (tabIndex -1).
function DialogHarness(): ReactNode {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Rules" footer={null}>
        <div className="flex items-center">
          <span>Session length</span>
          <InfoTip label="About Session length">{EXPLANATION}</InfoTip>
        </div>
      </Dialog>
    </KitRoot>
  );
}

const tipButton = () => page.getByRole("button", { name: "About Session length" });
const otherTipButton = () => page.getByRole("button", { name: "About Reminder time" });
const bubbleText = () => page.getByText(EXPLANATION);

async function setReducedMotion(isReduced: boolean): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: isReduced ? "reduce" : "" }],
  });
}

async function openTip(): Promise<HTMLElement> {
  await userEvent.click(tipButton());
  await expect.element(bubbleText()).toBeVisible();
  return bubbleText().element() as HTMLElement;
}

function getRunningAnimation(element: Element): Animation {
  const [animation] = element.getAnimations();
  if (!animation) throw new Error("No animation is playing");
  return animation;
}

function getKitRect(): DOMRect {
  const root = document.querySelector("[data-kit]");
  if (!root) throw new Error("No kit root");
  return root.getBoundingClientRect();
}

beforeEach(async () => {
  await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT);
});

afterEach(async () => {
  await setReducedMotion(false);
});

describe("InfoTip opening and closing", () => {
  it("opens on click and closes on a second click", async () => {
    await render(<Harness />);
    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "false");

    await openTip();
    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(tipButton());
    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "false");
    await expect.element(bubbleText()).not.toBeInTheDocument();
  });

  it("closes on Escape and keeps focus on the button", async () => {
    await render(<Harness />);
    await openTip();

    await userEvent.keyboard("{Escape}");

    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "false");
    await expect.element(bubbleText()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(tipButton().element());
  });

  it("closes on a click outside", async () => {
    await render(<Harness />);
    await openTip();

    await userEvent.click(page.getByText("Outside text"));

    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "false");
    await expect.element(bubbleText()).not.toBeInTheDocument();
  });

  it("stays open when the explanation itself is clicked", async () => {
    await render(<Harness />);
    const bubble = await openTip();

    await userEvent.click(bubble);

    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "true");
    await expect.element(bubbleText()).toBeVisible();
  });

  it("stays open with focus on the button when the explanation is clicked", async () => {
    await render(<Harness />);
    const bubble = await openTip();

    await userEvent.click(bubble);

    expect(document.activeElement).toBe(tipButton().element());
    await userEvent.keyboard("{Escape}");
    await expect.element(bubbleText()).not.toBeInTheDocument();
  });

  it("stays open inside a dialog when the explanation is clicked, and Escape closes only the tip", async () => {
    await render(<DialogHarness />);
    const bubble = await openTip();

    await userEvent.click(bubble);

    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "true");
    await expect.element(bubbleText()).toBeVisible();
    expect(document.activeElement).toBe(tipButton().element());

    await userEvent.keyboard("{Escape}");

    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByRole("dialog", { name: "Rules" })).toBeVisible();
  });

  it("closes when focus Tabs away", async () => {
    await render(<Harness />);
    await openTip();

    await userEvent.tab();

    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "false");
    await expect.element(bubbleText()).not.toBeInTheDocument();
  });

  it("closes an open tip when another one opens", async () => {
    await render(<Harness />);
    await openTip();

    await userEvent.click(otherTipButton());

    await expect.element(page.getByText("Sent the day before.")).toBeVisible();
    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "false");
    await expect.element(bubbleText()).not.toBeInTheDocument();
  });

  it("opens and closes by touch the same way", async () => {
    await render(<Harness />);
    const touch = { bubbles: true, pointerType: "touch" };
    const button = tipButton().element() as HTMLElement;

    button.dispatchEvent(new PointerEvent("pointerdown", touch));
    button.click();
    await expect.element(bubbleText()).toBeVisible();

    page.getByText("Outside text").element().dispatchEvent(new PointerEvent("pointerdown", touch));
    await expect.element(bubbleText()).not.toBeInTheDocument();
    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "false");
  });

  it("does not open on hover", async () => {
    await render(<Harness />);

    await userEvent.hover(tipButton());

    await expect.element(tipButton()).toHaveAttribute("aria-expanded", "false");
    await expect.element(bubbleText()).not.toBeInTheDocument();
  });
});

describe("InfoTip for assistive tech", () => {
  it("names the button with its label and hides the icon", async () => {
    await render(<Harness />);

    const button = tipButton().element();
    expect(button.getAttribute("type")).toBe("button");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("puts the explanation in a polite live region, controlled by the button", async () => {
    await render(<Harness />);
    const region = tipButton().element().parentElement?.querySelector('[role="status"]');
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.textContent).toBe("");

    const bubble = await openTip();

    expect(region?.contains(bubble)).toBe(true);
    const controlsId = tipButton().element().getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(bubble.closest(`#${CSS.escape(controlsId ?? "")}`)).not.toBeNull();
  });
});

describe("InfoTip layout", () => {
  it("has a 44px round target that doesn't grow its label row", async () => {
    await render(<Harness />);

    const button = tipButton().element().getBoundingClientRect();
    expect(button.width).toBe(TARGET_PX);
    expect(button.height).toBe(TARGET_PX);
    const row = page.getByTestId("label-row").element().getBoundingClientRect();
    expect(row.height).toBeLessThan(TARGET_PX);
  });

  it("shows the open state in tint-strong and primary ink", async () => {
    await render(<Harness />);
    await openTip();

    const button = tipButton().element();
    expect(button.className).toContain("bg-(--tl-tint-strong)");
    expect(button.className).toContain("text-(--tl-primary-ink)");
  });

  it("drops the bubble under the button, left-aligned, at most 280px wide", async () => {
    await render(<Harness />);
    const bubble = await openTip();
    const panel = bubble.closest("[id]") as HTMLElement;

    const buttonRect = tipButton().element().getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    expect(panelRect.width).toBeLessThanOrEqual(BUBBLE_MAX_PX);
    expect(panelRect.left).toBeCloseTo(buttonRect.left, 0);
    expect(panelRect.top).toBeGreaterThanOrEqual(buttonRect.bottom);
  });

  for (const width of [PHONE_WIDTH, NARROW_WIDTH]) {
    it(`keeps the bubble inside the kit with no horizontal scroll at ${width}px`, async () => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      await render(<Harness isAtRightEdge />);
      const bubble = await openTip();
      const panel = bubble.closest("[id]") as HTMLElement;

      const kit = getKitRect();
      const panelRect = panel.getBoundingClientRect();
      expect(panelRect.right).toBeLessThanOrEqual(kit.right - KIT_EDGE_INSET_PX + 0.5);
      expect(panelRect.left).toBeGreaterThanOrEqual(kit.left + KIT_EDGE_INSET_PX - 0.5);
      expect(panelRect.width).toBeLessThanOrEqual(kit.width - 2 * KIT_EDGE_INSET_PX + 0.5);
      const scrollArea = document.querySelector("[data-kit-scroll]") as HTMLElement;
      expect(scrollArea.scrollWidth).toBeLessThanOrEqual(scrollArea.clientWidth);
    });
  }

  for (const theme of THEMES) {
    for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) {
      it(`uses kit tokens and no text under 12px in ${theme} at ${width}px`, async () => {
        await page.viewport(width, VIEWPORT_HEIGHT);
        await render(<Harness theme={theme} />);
        const bubble = await openTip();
        const panel = bubble.closest("[id]") as HTMLElement;

        expect(panel.className).toContain("bg-(--tl-surface)");
        expect(panel.className).toContain("border-(--tl-card-border)");
        expect(panel.className).toContain("kit-shadow-raised");
        expect(panel.className).toContain("rounded-[20px]");
        const fontSize = Number.parseFloat(getComputedStyle(bubble).fontSize);
        expect(fontSize).toBeGreaterThanOrEqual(MIN_TEXT_PX);
        const surface = getComputedStyle(panel).backgroundColor;
        expect(surface).not.toBe("rgba(0, 0, 0, 0)");
      });
    }
  }
});

describe("InfoTip motion", () => {
  it("rises in over 220ms and plays it back out over 160ms", async () => {
    await render(<Harness />);
    await userEvent.click(tipButton());
    await expect.element(bubbleText()).toBeVisible();
    const panel = bubbleText().element().closest("[id]") as HTMLElement;

    const enter = getRunningAnimation(panel);
    expect(enter.effect?.getTiming().duration).toBe(RISE_MS);
    await enter.finished;

    await userEvent.click(tipButton());

    const exit = getRunningAnimation(panel);
    expect(exit.effect?.getTiming().duration).toBe(EXIT_MS);
    expect(panel.isConnected).toBe(true);
    await expect.poll(() => panel.isConnected).toBe(false);
  });

  it("opens and closes instantly with reduced motion", async () => {
    await setReducedMotion(true);
    await render(<Harness />);
    const bubble = await openTip();
    const panel = bubble.closest("[id]") as HTMLElement;
    expect(panel.getAnimations()).toHaveLength(0);

    await userEvent.click(tipButton());

    expect(panel.isConnected).toBe(false);
  });
});
