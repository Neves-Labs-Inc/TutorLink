import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { WelcomeCard } from "@/components/kit/components/welcome-card";
import type { Theme } from "@/components/kit/tokens";

const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 375;
const VIEWPORT_HEIGHT = 800;
const KIT_HEIGHT = "600px";
const TARGET_PX = 44;
const CHIP_PX = 40;
// The X sits inside the card's padding, pulled toward its corner.
const CORNER_INSET_PX = 20;
const MIN_TEXT_PX = 12;
const BODY_FONT_PX = 15;
const BODY_LINE_PX = 24;
const FADE_ENTER_MS = 180;
const EXIT_MS = 160;
const THEMES: Theme[] = ["light", "dark"];
const TITLE = "Welcome to TutorLink";
const BODY =
  "Home shows what needs you today: chats, Bookings and Time off waiting in To do. Families, Staff and Settings are in the menu.";

type HarnessProps = { theme?: Theme; onDismiss?: () => void };

// Keeps the card mounted after Dismiss, as LandingWelcome does, so its fade can play.
function Harness({ theme = "light", onDismiss = () => undefined }: HarnessProps): ReactNode {
  return (
    <KitRoot theme={theme} height={KIT_HEIGHT}>
      <main className="flex flex-col gap-6 p-4">
        <h1>Home</h1>
        <WelcomeCard title={TITLE} body={BODY} onDismiss={onDismiss} />
        <p>Below the card</p>
      </main>
    </KitRoot>
  );
}

const card = () => page.getByRole("region", { name: TITLE });
const dismissButton = () => page.getByRole("button", { name: "Dismiss welcome" });

async function setReducedMotion(isReduced: boolean): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: isReduced ? "reduce" : "" }],
  });
}

function getRunningAnimation(element: Element): Animation {
  const [animation] = element.getAnimations();
  if (!animation) throw new Error("No animation is playing");
  return animation;
}

beforeEach(async () => {
  await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT);
});

afterEach(async () => {
  await setReducedMotion(false);
});

describe("WelcomeCard", () => {
  it("shows the title as a heading, the body and a Dismiss button", async () => {
    await render(<Harness />);

    await expect.element(card()).toBeVisible();
    await expect.element(page.getByRole("heading", { level: 2, name: TITLE })).toBeVisible();
    await expect.element(page.getByText(BODY)).toBeVisible();
    await expect.element(dismissButton()).toBeVisible();
  });

  it("calls onDismiss once at the click, then fades out and renders nothing", async () => {
    const onDismiss = vi.fn();
    await render(<Harness onDismiss={onDismiss} />);
    const section = card().element();
    await getRunningAnimation(section).finished;

    await userEvent.click(dismissButton());

    expect(onDismiss).toHaveBeenCalledTimes(1);
    const exit = getRunningAnimation(section);
    expect(exit.effect?.getTiming().duration).toBe(EXIT_MS);
    await expect.poll(() => section.isConnected).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("fades in over 180ms when it first renders", async () => {
    await render(<Harness />);

    const enter = getRunningAnimation(card().element());
    expect(enter.effect?.getTiming().duration).toBe(FADE_ENTER_MS);
  });

  it("moves focus to the page heading on Dismiss", async () => {
    await render(<Harness />);

    await userEvent.click(dismissButton());

    const heading = page.getByRole("heading", { level: 1 }).element();
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("tabindex")).toBe("-1");
  });

  it("leaves at once with reduced motion", async () => {
    await setReducedMotion(true);
    const onDismiss = vi.fn();
    await render(<Harness onDismiss={onDismiss} />);
    expect(card().element().getAnimations()).toHaveLength(0);

    await userEvent.click(dismissButton());

    expect(onDismiss).toHaveBeenCalledTimes(1);
    await expect.element(card()).not.toBeInTheDocument();
  });

  for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) {
    it(`puts the 44px Dismiss in the top-right corner without adding height at ${width}px`, async () => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      await render(<Harness />);

      const cardRect = card().element().getBoundingClientRect();
      const button = dismissButton().element().getBoundingClientRect();
      expect(button.width).toBe(TARGET_PX);
      expect(button.height).toBe(TARGET_PX);
      expect(cardRect.right - button.right).toBeLessThan(CORNER_INSET_PX);
      expect(button.top - cardRect.top).toBeLessThan(CORNER_INSET_PX);
      // Pulled up into the padding: the card is no taller than its text needs.
      const heading = page.getByRole("heading", { name: TITLE }).element().getBoundingClientRect();
      expect(button.top).toBeLessThan(heading.top);
      const textBlock = page.getByText(BODY).element().getBoundingClientRect();
      const chip = card().element().firstElementChild?.getBoundingClientRect();
      expect(chip?.width).toBe(CHIP_PX);
      expect(chip?.height).toBe(CHIP_PX);
      expect(textBlock.left).toBeGreaterThan(chip?.right ?? 0);
    });
  }

  for (const theme of THEMES) {
    for (const width of [PHONE_WIDTH, DESKTOP_WIDTH]) {
      it(`uses kit tokens and no text under 12px in ${theme} at ${width}px`, async () => {
        await page.viewport(width, VIEWPORT_HEIGHT);
        await render(<Harness theme={theme} />);

        const section = card().element();
        expect(section.className).toContain("bg-(--tl-surface)");
        expect(section.className).toContain("border-(--tl-card-border)");
        const chip = section.firstElementChild;
        expect(chip?.className).toContain("bg-(--tl-tint-strong)");
        expect(chip?.className).toContain("text-(--tl-primary-ink)");
        const body = page.getByText(BODY).element();
        const bodyStyle = getComputedStyle(body);
        expect(Number.parseFloat(bodyStyle.fontSize)).toBe(BODY_FONT_PX);
        expect(Number.parseFloat(bodyStyle.lineHeight)).toBe(BODY_LINE_PX);
        const texts = [body, page.getByRole("heading", { name: TITLE }).element()];
        for (const element of texts) {
          expect(Number.parseFloat(getComputedStyle(element).fontSize)).toBeGreaterThanOrEqual(
            MIN_TEXT_PX,
          );
        }
        const scrollArea = document.querySelector("[data-kit-scroll]") as HTMLElement;
        expect(scrollArea.scrollWidth).toBeLessThanOrEqual(scrollArea.clientWidth);
      });
    }
  }
});
