import { useState } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { Combobox } from "@/components/kit/components/combobox";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import type { ComboboxOption } from "@/components/kit/types/combobox";

const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 390;
const VIEWPORT_HEIGHT = 800;
const KIT_HEIGHT = "600px";
// Comfortably past the 160ms exit.
const EXIT_SETTLED_MS = 400;
const LISTBOX_MIN_HEIGHT_PX = 288;

const STAFF: ComboboxOption[] = [
  {
    value: "maria",
    label: "Maria Lopez",
    description: "Math · Reading",
    hasAvatar: true,
  },
  {
    value: "daniela",
    label: "Daniela Ruiz",
    description: "Writing",
    hasAvatar: true,
  },
  { value: "marco", label: "Marco Silva", description: "Science" },
  { value: "ana", label: "Ana Costa", description: "Spanish" },
];

const MANY_STAFF: ComboboxOption[] = Array.from({ length: 20 }, (_, index) => ({
  value: `staff-${index}`,
  label: `Staff ${index}`,
}));
const LAST_STAFF = MANY_STAFF.length - 1;

type HarnessProps = {
  options?: ComboboxOption[];
  initialValue?: string | null;
  error?: string;
  onChange?: (value: string) => void;
};

function Harness({
  options = STAFF,
  initialValue = null,
  error,
  onChange,
}: HarnessProps): ReactNode {
  const [value, setValue] = useState(initialValue);
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <div className="flex flex-col gap-4 p-6">
        <button type="button">Before</button>
        <Combobox
          label="Staff"
          placeholder="Search Staff"
          options={options}
          value={value}
          error={error}
          help="Only Staff who teach this level."
          onChange={(next) => {
            setValue(next);
            onChange?.(next);
          }}
        />
      </div>
    </KitRoot>
  );
}

// Like the booking form: the Combobox sits in a phone-page overlay.
function InOverlayHarness(): ReactNode {
  const [value, setValue] = useState<string | null>(null);
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <DetailOverlay
        isOpen
        onClose={() => undefined}
        title="New booking"
        backLabel="Back"
        phoneMode="page"
        header={<h2>New booking</h2>}
      >
        <Combobox
          label="Staff"
          options={STAFF}
          value={value}
          onChange={setValue}
        />
      </DetailOverlay>
    </KitRoot>
  );
}

function getKitScrollTops(): number[] {
  const scrollers = document.querySelectorAll("[data-kit], [data-kit-scroll]");
  return [...scrollers].map((element) => element.scrollTop);
}

const trigger = () =>
  page.getByRole("combobox", { name: "Staff", exact: true });
const listbox = () => page.getByRole("listbox", { name: "Staff" });
const option = (name: string) =>
  page.getByRole("option", { name: new RegExp(`^${name}`) });
// The polite count line, read by text: the field and the sheet each have one.
const count = (text: string) =>
  page.getByRole("status").filter({ hasText: text });

// A real touch tap at the element's centre, so its late compatibility
// click lands wherever the tap opened something.
async function tap(element: Element): Promise<void> {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement?.getBoundingClientRect();
  const scale = frame ? frame.width / window.innerWidth : 1;
  const x = (frame?.left ?? 0) + (box.left + box.width / 2) * scale;
  const y = (frame?.top ?? 0) + (box.top + box.height / 2) * scale;
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp().send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  await cdp().send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp().send("Emulation.setTouchEmulationEnabled", { enabled: false });
}

async function tabToTrigger(): Promise<void> {
  page.getByRole("button", { name: "Before" }).element().focus();
  await userEvent.tab();
}

describe("kit Combobox", () => {
  describe("on a wide kit", () => {
    beforeEach(async () => {
      await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT);
    });

    it("doesn't open on focus, and opens the in-flow listbox on click", async () => {
      await render(<Harness />);
      await tabToTrigger();
      await expect.element(trigger()).toHaveFocus();
      await expect.element(trigger()).toHaveAttribute("aria-expanded", "false");

      await userEvent.click(trigger());

      await expect.element(listbox()).toBeVisible();
      await expect.element(trigger()).toHaveAttribute("aria-expanded", "true");
      expect(page.getByRole("dialog").elements()).toHaveLength(0);
    });

    it("filters as you type, and Enter picks with focus kept on the trigger", async () => {
      const handleChange = vi.fn();
      await render(<Harness onChange={handleChange} />);
      await userEvent.click(trigger());

      await userEvent.keyboard("mar");
      expect(page.getByRole("option").elements()).toHaveLength(2);
      await expect.element(count("2 matches")).toBeInTheDocument();
      await userEvent.keyboard("{ArrowDown}");
      await expect
        .element(trigger())
        .toHaveAttribute("aria-activedescendant", option("Marco Silva").element().id);
      await userEvent.keyboard("{Enter}");

      expect(handleChange).toHaveBeenCalledWith("marco");
      await expect.element(trigger()).toHaveValue("Marco Silva");
      await expect.element(trigger()).toHaveFocus();
      await expect.element(trigger()).toHaveAttribute("aria-expanded", "false");
    });

    it("keeps the filtered rows while the picked list leaves", async () => {
      await render(<Harness />);
      await userEvent.click(trigger());
      await userEvent.keyboard("dan");
      const list = listbox().element() as HTMLElement;

      await userEvent.keyboard("{Enter}");

      expect(list.isConnected).toBe(true);
      expect(list.querySelectorAll('[role="option"]')).toHaveLength(1);
      await expect.poll(() => list.isConnected).toBe(false);
    });

    it("opens on ArrowDown at the selected option, and Escape closes keeping focus", async () => {
      await render(<Harness initialValue="daniela" />);
      await tabToTrigger();

      await userEvent.keyboard("{ArrowDown}");

      await expect.element(listbox()).toBeVisible();
      await expect
        .element(trigger())
        .toHaveAttribute("aria-activedescendant", option("Daniela Ruiz").element().id);
      await expect.element(option("Daniela Ruiz")).toHaveAttribute("aria-selected", "true");

      await userEvent.keyboard("{Escape}");

      await expect.element(trigger()).toHaveAttribute("aria-expanded", "false");
      await expect.element(trigger()).toHaveValue("Daniela Ruiz");
      await expect.element(trigger()).toHaveFocus();
    });

    it("opens on a typed letter, filtering by it", async () => {
      await render(<Harness initialValue="maria" />);
      await tabToTrigger();

      await userEvent.keyboard("s");

      await expect.element(listbox()).toBeVisible();
      await expect.element(trigger()).toHaveValue("s");
      expect(page.getByRole("option").elements()).toHaveLength(2);
    });

    it("says when nothing matches, or there is nothing to pick", async () => {
      const { rerender } = await render(<Harness />);
      await userEvent.click(trigger());
      await userEvent.keyboard(" zz ");

      await expect.element(listbox()).toHaveTextContent("No matches for “zz”.");
      await expect.element(count("No matches for “zz”.")).toBeInTheDocument();
      expect(page.getByRole("option").elements()).toHaveLength(0);

      await userEvent.keyboard("{Escape}");
      await rerender(<Harness options={[]} />);
      await userEvent.click(trigger());
      await expect.element(listbox()).toHaveTextContent("Nothing to pick.");
    });

    it("leaves the trigger's keyboard alone on a wide kit", async () => {
      await render(<Harness />);
      await userEvent.click(trigger());
      await expect.element(listbox()).toBeVisible();

      expect(trigger().element().hasAttribute("inputmode")).toBe(false);
    });

    it("keeps the error border while open", async () => {
      await render(<Harness error="Pick a Staff member." />);
      const input = trigger().element();
      const closedBorder = getComputedStyle(input).borderColor;

      await userEvent.click(trigger());
      await expect.element(listbox()).toBeVisible();

      expect(getComputedStyle(input).borderColor).toBe(closedBorder);
      await expect.element(trigger()).toHaveAttribute("aria-invalid", "true");
      await expect
        .element(page.getByText("Pick a Staff member."))
        .toBeVisible();
    });
  });

  describe("on a phone-width kit", () => {
    beforeEach(async () => {
      await page.viewport(PHONE_WIDTH, VIEWPORT_HEIGHT);
    });

    const sheet = () => page.getByRole("dialog", { name: "Staff" });
    const search = () => page.getByRole("combobox", { name: "Search Staff" });

    it("opens a sheet titled with the label on tap, focusing its search, never the trigger", async () => {
      await render(<Harness />);
      const handleFocus = vi.fn();
      trigger().element().addEventListener("focus", handleFocus);

      await userEvent.click(trigger());

      await expect.element(sheet()).toBeVisible();
      await expect.element(search()).toHaveFocus();
      await expect.element(search()).toHaveAttribute("aria-expanded", "true");
      await expect.element(search()).toHaveAttribute("placeholder", "Search Staff");
      expect(handleFocus).not.toHaveBeenCalled();
    });

    it("stays open after a touch tap opens it, with focus in the search", async () => {
      await render(<Harness />);
      const handleFocus = vi.fn();
      trigger().element().addEventListener("focus", handleFocus);

      await tap(trigger().element());

      await expect.element(search()).toHaveFocus();
      await new Promise((resolve) => setTimeout(resolve, EXIT_SETTLED_MS));
      await expect.element(sheet()).toBeVisible();
      expect(handleFocus).not.toHaveBeenCalled();
    });

    it("filters as you type and a tap picks, closing to the trigger without reopening", async () => {
      const handleChange = vi.fn();
      await render(<Harness onChange={handleChange} />);
      await userEvent.click(trigger());

      await userEvent.keyboard("ana");
      await expect.element(count("1 match")).toBeInTheDocument();
      await userEvent.click(option("Ana Costa"));

      expect(handleChange).toHaveBeenCalledWith("ana");
      await expect.element(sheet()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveValue("Ana Costa");
      await expect.element(trigger()).toHaveFocus();
      await new Promise((resolve) => setTimeout(resolve, EXIT_SETTLED_MS));
      await expect.element(trigger()).toHaveAttribute("aria-expanded", "false");
      expect(page.getByRole("dialog").elements()).toHaveLength(0);
    });

    it("moves and picks with the keyboard after opening from the focused trigger", async () => {
      const handleChange = vi.fn();
      await render(<Harness initialValue="daniela" onChange={handleChange} />);
      await tabToTrigger();

      await userEvent.keyboard("{ArrowDown}");
      await expect.element(search()).toHaveFocus();
      await expect
        .element(search())
        .toHaveAttribute("aria-activedescendant", option("Daniela Ruiz").element().id);
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Enter}");

      expect(handleChange).toHaveBeenCalledWith("marco");
      await expect.element(sheet()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveFocus();
    });

    it("seeds the search with a letter typed on the trigger", async () => {
      await render(<Harness />);
      await tabToTrigger();

      await userEvent.keyboard("w");

      await expect.element(search()).toHaveValue("w");
      await expect.element(search()).toHaveFocus();
      expect(page.getByRole("option").elements()).toHaveLength(1);
    });

    it("closes on one Escape even with text in the search, keeping the value", async () => {
      const handleChange = vi.fn();
      await render(<Harness initialValue="maria" onChange={handleChange} />);
      await userEvent.click(trigger());
      await userEvent.keyboard("dan");

      await userEvent.keyboard("{Escape}");

      await expect.element(sheet()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveValue("Maria Lopez");
      await expect.element(trigger()).toHaveFocus();
      expect(handleChange).not.toHaveBeenCalled();
    });

    it("keeps its height as matches narrow, and says when nothing matches", async () => {
      await render(<Harness />);
      await userEvent.click(trigger());
      await expect.element(sheet()).toBeVisible();
      const panel = sheet().element() as HTMLElement;
      await Promise.all(panel.getAnimations().map((animation) => animation.finished));
      const panelHeight = panel.offsetHeight;
      expect(
        listbox().element().getBoundingClientRect().height,
      ).toBeGreaterThanOrEqual(LISTBOX_MIN_HEIGHT_PX);

      await userEvent.keyboard("zz");

      await expect.element(listbox()).toHaveTextContent("No matches for “zz”.");
      expect(panel.offsetHeight).toBe(panelHeight);
    });

    it("says there is nothing to pick for an empty list", async () => {
      await render(<Harness options={[]} />);
      await userEvent.click(trigger());

      await expect.element(listbox()).toHaveTextContent("Nothing to pick.");
    });

    it("opens on screen from inside an overlay, without scrolling the kit", async () => {
      await render(<InOverlayHarness />);
      await tap(trigger().element());

      await expect.element(search()).toHaveFocus();
      const panel = sheet().element() as HTMLElement;
      await Promise.all(panel.getAnimations().map((animation) => animation.finished));
      expect(getKitScrollTops().every((top) => top === 0)).toBe(true);
      expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
      expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    });

    it("pins the search above the rows, and keeps the active row clear of it", async () => {
      await render(<Harness options={MANY_STAFF} />);
      await userEvent.click(trigger());
      await expect.element(search()).toHaveFocus();
      const panel = sheet().element() as HTMLElement;
      await Promise.all(panel.getAnimations().map((animation) => animation.finished));
      const searchBox = () =>
        search().element().closest(".sticky")?.getBoundingClientRect();
      const pinnedBottom = searchBox()?.bottom ?? 0;
      expect(option("Staff 0").element().getBoundingClientRect().top)
        .toBeGreaterThanOrEqual(pinnedBottom);

      for (let index = 0; index < LAST_STAFF; index++) {
        await userEvent.keyboard("{ArrowDown}");
      }
      await expect
        .element(search())
        .toHaveAttribute("aria-activedescendant", option(`Staff ${LAST_STAFF}`).element().id);
      expect(searchBox()?.bottom).toBe(pinnedBottom);
      for (let index = LAST_STAFF; index > 0; index--) {
        await userEvent.keyboard("{ArrowUp}");
      }
      expect(option("Staff 0").element().getBoundingClientRect().top)
        .toBeGreaterThanOrEqual(pinnedBottom);
    });

    it("holds a full sheet's height while matches narrow to none", async () => {
      await render(<Harness options={MANY_STAFF} />);
      await userEvent.click(trigger());
      await expect.element(search()).toHaveFocus();
      const panel = sheet().element() as HTMLElement;
      await Promise.all(panel.getAnimations().map((animation) => animation.finished));
      const openTop = panel.getBoundingClientRect().top;

      await userEvent.keyboard("Staff 1");
      await expect.element(count("11 matches")).toBeInTheDocument();
      expect(panel.getBoundingClientRect().top).toBe(openTop);
      await userEvent.keyboard("zz");
      await expect.element(count("No matches for “Staff 1zz”.")).toBeInTheDocument();
      expect(panel.getBoundingClientRect().top).toBe(openTop);
    });

    it("keeps the soft keyboard down when focus comes back to the trigger", async () => {
      await render(<Harness />);
      await userEvent.click(trigger());
      await userEvent.click(option("Ana Costa"));

      await expect.element(trigger()).toHaveFocus();
      await expect.element(trigger()).toHaveAttribute("inputmode", "none");
    });

    it("keeps focus in the search while a row is pressed", async () => {
      await render(<Harness />);
      await userEvent.click(trigger());
      await expect.element(search()).toHaveFocus();
      const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });

      option("Daniela Ruiz").element().dispatchEvent(press);

      // A cancelled mousedown is what keeps the browser from moving focus.
      expect(press.defaultPrevented).toBe(true);
      await expect.element(search()).toHaveFocus();
    });

    it("shows the no-match row after typing from the bottom of a long list", async () => {
      await render(<Harness options={MANY_STAFF} />);
      await userEvent.click(trigger());
      await expect.element(search()).toHaveFocus();
      const panel = sheet().element() as HTMLElement;
      await Promise.all(panel.getAnimations().map((animation) => animation.finished));
      const scroller = listbox().element().parentElement;
      if (!scroller) throw new Error("listbox has no scroller");
      scroller.scrollTop = scroller.scrollHeight;

      await userEvent.keyboard("zz");

      const noMatch = listbox().getByText("No matches for “zz”.");
      await expect.element(noMatch).toBeVisible();
      const rowBox = noMatch.element().getBoundingClientRect();
      const scrollerBox = scroller.getBoundingClientRect();
      const searchBottom =
        search().element().closest(".sticky")?.getBoundingClientRect().bottom ?? 0;
      expect(rowBox.top).toBeGreaterThanOrEqual(searchBottom);
      expect(rowBox.bottom).toBeLessThanOrEqual(scrollerBox.bottom);
    });

    it("gives the trigger its keyboard back once the kit is wide", async () => {
      await render(<Harness />);
      await userEvent.click(trigger());
      await userEvent.click(option("Ana Costa"));
      await expect.element(trigger()).toHaveAttribute("inputmode", "none");
      trigger().element().blur();

      await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT);
      trigger().element().focus();

      expect(trigger().element().hasAttribute("inputmode")).toBe(false);
    });

    it("clears the search and returns focus to it", async () => {
      await render(<Harness />);
      await userEvent.click(trigger());
      await userEvent.keyboard("ma");

      await userEvent.click(page.getByRole("button", { name: "Clear search" }));

      await expect.element(search()).toHaveValue("");
      await expect.element(search()).toHaveFocus();
      expect(page.getByRole("option").elements()).toHaveLength(STAFF.length);
    });
  });
});
