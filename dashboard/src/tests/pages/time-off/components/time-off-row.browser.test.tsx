import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import { CARD, cn } from "@/components/kit/tokens";
import type { ExceptionRead } from "@/lib/queries/time-off";
import TimeOffRow from "@/pages/time-off/components/time-off-row";
import type { TimeOffRowVariant } from "@/pages/time-off/components/time-off-row";
import { renderWithProviders } from "@/test/render-with-providers";

const DESKTOP = 1280;
const PHONE = 390;
const HEIGHT = 800;
const MIN_ROW_HEIGHT = 72;

const ITEM: ExceptionRead = {
  id: "to-1",
  staff: { id: "u-tutor", name: "Marco Bell", role: "tutor" },
  start_date: "2031-10-20",
  end_date: "2031-10-22",
  start_time: null,
  end_time: null,
  reason: "Family trip",
  status: "pending",
  created_at: "2031-10-14T19:10:00Z",
  decided_by: null,
  decided_at: null,
  cancelled_by: null,
  cancelled_at: null,
  entered_by: null,
  clashing_bookings: [],
  clashing_bookings_count: 2,
};

async function renderRow(
  variant: TimeOffRowVariant,
  item: ExceptionRead = ITEM,
  onOpen = vi.fn(),
) {
  await renderWithProviders(
    <KitRoot theme="light">
      <ul className={cn(CARD, "divide-y divide-(--tl-border) overflow-hidden")}>
        <TimeOffRow item={item} variant={variant} onOpen={onOpen} />
      </ul>
    </KitRoot>,
  );
  return onOpen;
}

const row = () => page.getByRole("button");
const dates = () => page.getByText("Mon, Oct 20 – Wed, Oct 22");
const rectOf = (element: Element) => element.getBoundingClientRect();

// The visible one of the two badge spots.
function visibleBadge(): Element {
  const badges = page.getByText("Pending", { exact: true }).elements();
  const shown = badges.find((badge) => rectOf(badge).height > 0);
  if (!shown) throw new Error("no visible badge");
  return shown;
}

function tokenColor(token: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  document.querySelector("[data-kit]")?.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

beforeEach(async () => {
  await page.viewport(DESKTOP, HEIGHT);
});

describe.each([DESKTOP, PHONE])("at %ipx", (width) => {
  beforeEach(async () => {
    await page.viewport(width, HEIGHT);
  });

  it("draws an own row: Plane chip, length and reason, clash line", async () => {
    await renderRow("own");

    await expect.element(dates()).toBeVisible();
    await expect.element(page.getByText("3 days · Family trip")).toBeVisible();
    await expect.element(page.getByText("2 sessions in these dates")).toBeVisible();
    const chip = row().element().querySelector("span.rounded-\\[14px\\]");
    expect(chip).not.toBeNull();
    expect(rectOf(row().element()).height).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT);
  });

  it("draws a compact row: dates and reason only, still 72px tall", async () => {
    await renderRow("compact", { ...ITEM, reason: null });

    await expect.element(dates()).toBeVisible();
    await expect.element(page.getByText("No reason given")).toBeVisible();
    expect(page.getByText(/in these dates/).elements()).toHaveLength(0);
    expect(row().element().querySelector("span.rounded-\\[14px\\]")).toBeNull();
    expect(rectOf(row().element()).height).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT);
  });

  it("mutes the dates once the time off is closed", async () => {
    await renderRow("own", { ...ITEM, status: "cancelled" });
    await expect.element(dates()).toBeVisible();

    expect(getComputedStyle(dates().element()).color).toBe(tokenColor("--tl-muted"));
  });

  it("keeps open time off in ink", async () => {
    await renderRow("own");
    await expect.element(dates()).toBeVisible();

    expect(getComputedStyle(dates().element()).color).not.toBe(
      tokenColor("--tl-muted"),
    );
  });

  it("opens the details by id", async () => {
    const onOpen = await renderRow("compact");
    await row().click();
    expect(onOpen).toHaveBeenCalledWith("to-1");
  });
});

describe("badge placement", () => {
  it("puts the badge under the dates below 448px of row width", async () => {
    await page.viewport(PHONE, HEIGHT);
    await renderRow("own");
    await expect.element(dates()).toBeVisible();

    expect(rectOf(visibleBadge()).top).toBeGreaterThanOrEqual(
      rectOf(dates().element()).bottom,
    );
  });

  it("trails the badge after the dates from 448px of row width", async () => {
    await renderRow("own");
    await expect.element(dates()).toBeVisible();

    const badge = rectOf(visibleBadge());
    const datesRect = rectOf(dates().element());
    expect(badge.left).toBeGreaterThan(datesRect.right);
    expect(badge.top).toBeLessThan(datesRect.bottom);
  });
});

describe("focus", () => {
  it("draws the focus ring inside the row, so the card can’t clip it", async () => {
    await renderRow("own");
    await expect.element(dates()).toBeVisible();
    await userEvent.tab();

    expect(document.activeElement).toBe(row().element());
    expect(getComputedStyle(row().element()).outlineOffset).toBe("-2px");
  });
});
