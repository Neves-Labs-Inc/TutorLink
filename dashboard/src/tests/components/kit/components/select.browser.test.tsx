import { useState } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { SelectField } from "@/components/kit/components/fields";
import Select from "@/components/kit/components/select";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { Dialog } from "@/components/kit/overlays/dialog";
import type { SelectOption } from "@/components/kit/components/fields";

const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 800;
const PHONE_WIDTH = 390;
const PHONE_HEIGHT = 800;
const POPOVER_MIN_WIDTH_PX = 200;
const POPOVER_MAX_WIDTH_PX = 320;
const KIT_EDGE_INSET_PX = 8;
const TOUCH_CLICK_DELAY_MS = 50;
const KIT_HEIGHT = "600px";

const SUBJECTS: SelectOption[] = [
  { value: "math", label: "Math" },
  { value: "reading", label: "Reading" },
  { value: "writing", label: "Writing" },
  { value: "science", label: "Science" },
  { value: "spanish", label: "Spanish" },
];

type FieldHarnessProps = {
  initialValue?: string;
  onChange?: (event: { target: { value: string } }) => void;
  onValueChange?: (value: string) => void;
};

// A controlled SelectField, read the way existing callers read it.
function FieldHarness({
  initialValue = "reading",
  onChange,
  onValueChange,
}: FieldHarnessProps): ReactNode {
  const [subject, setSubject] = useState(initialValue);
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <div className="p-6">
        <p>Outside</p>
        <SelectField
          label="Subject"
          options={SUBJECTS}
          value={subject}
          onChange={(event) => {
            setSubject(event.target.value);
            onChange?.(event);
          }}
          onValueChange={onValueChange}
        />
      </div>
    </KitRoot>
  );
}

const HOURS: SelectOption[] = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `Hour ${hour}`,
}));
const LATE_HOUR = 20;
const MIDDAY_HOUR = 12;

// A list longer than the phone sheet's body, starting near its end.
function LongListHarness({ hour }: { hour: number }): ReactNode {
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <div className="p-6">
        <SelectField
          label="Time"
          options={HOURS}
          defaultValue={String(hour)}
        />
      </div>
    </KitRoot>
  );
}

const DETECTED_LANGUAGES: SelectOption[] = [
  { value: "", label: "Language not detected" },
  { value: "en", label: "English" },
];

// An inline Select like the chat thread's language picker.
function LanguageHarness({
  languages,
}: {
  languages: SelectOption[];
}): ReactNode {
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <div className="p-6">
        <Select
          aria-label="Language"
          label="Language"
          options={languages}
          defaultValue=""
          variant="inline"
        />
      </div>
    </KitRoot>
  );
}

type OverlayKind = "dialog" | "sheet";

// A SelectField inside an open kit overlay titled "Edit Booking".
type OverlayHarnessProps = { kind: OverlayKind; onSave?: () => void };

function OverlayHarness({ kind, onSave }: OverlayHarnessProps): ReactNode {
  const [isOpen, setIsOpen] = useState(true);
  const saveButton = (
    <button type="button" onClick={onSave}>
      Save
    </button>
  );
  // Narrow, so its 200px list leaves the right-aligned footer uncovered.
  const field = (
    <div className="w-[200px]">
      <SelectField label="Subject" options={SUBJECTS} defaultValue="math" />
    </div>
  );
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      {kind === "dialog" ? (
        <Dialog
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Edit Booking"
          footer={saveButton}
        >
          {field}
        </Dialog>
      ) : (
        <BottomSheet
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Edit Booking"
          footer={saveButton}
        >
          {field}
        </BottomSheet>
      )}
    </KitRoot>
  );
}

function getBox(element: Element): DOMRect {
  return element.getBoundingClientRect();
}

// Whole row inside the box that scrolls the list.
function isShownInList(row: Element): boolean {
  const scroller = page.getByRole("listbox").element().parentElement;
  if (!scroller) return false;
  const rowBox = getBox(row);
  const scrollerBox = getBox(scroller);
  return rowBox.top >= scrollerBox.top && rowBox.bottom <= scrollerBox.bottom;
}

function getKitScrollTops(): number[] {
  const scrollers = document.querySelectorAll("[data-kit], [data-kit-scroll]");
  return [...scrollers].map((element) => element.scrollTop);
}

const subject = () => page.getByRole("combobox", { name: "Subject" });
const listbox = () => page.getByRole("listbox");
const option = (name: string) =>
  page.getByRole("option", { name, exact: true });

describe("kit Select", () => {
  beforeEach(async () => {
    await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT);
  });

  it("shows the value, and opens a listbox marking the selected option", async () => {
    await render(<FieldHarness />);
    await expect.element(subject()).toHaveTextContent("Reading");
    await expect.element(subject()).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(subject());

    await expect.element(listbox()).toBeVisible();
    await expect.element(subject()).toHaveAttribute("aria-expanded", "true");
    await expect.element(option("Reading")).toHaveAttribute("aria-selected", "true");
    await expect.element(option("Math")).toHaveAttribute("aria-selected", "false");
  });

  it("picks with the keyboard and reports the value both ways", async () => {
    const handleChange = vi.fn();
    const handleValueChange = vi.fn();
    await render(
      <FieldHarness onChange={handleChange} onValueChange={handleValueChange} />,
    );
    subject().element().focus();

    await userEvent.keyboard("{ArrowDown}");
    await expect.element(listbox()).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");

    await expect.element(listbox()).not.toBeInTheDocument();
    await expect.element(subject()).toHaveTextContent("Writing");
    await expect.element(subject()).toHaveFocus();
    expect(handleChange).toHaveBeenCalledWith({
      target: { value: "writing", name: undefined },
    });
    expect(handleValueChange).toHaveBeenCalledWith("writing");
  });

  it("moves with Up, Home, End and type-ahead, and Escape keeps the value", async () => {
    await render(<FieldHarness />);
    subject().element().focus();

    await userEvent.keyboard("{End}");
    await expect.element(subject()).toHaveAttribute("aria-activedescendant", option("Spanish").element().id);
    await userEvent.keyboard("{ArrowUp}");
    await expect.element(subject()).toHaveAttribute("aria-activedescendant", option("Science").element().id);
    await userEvent.keyboard("{Home}");
    await expect.element(subject()).toHaveAttribute("aria-activedescendant", option("Math").element().id);
    await userEvent.keyboard("s");
    await expect.element(subject()).toHaveAttribute("aria-activedescendant", option("Science").element().id);
    await userEvent.keyboard("s");
    await expect.element(subject()).toHaveAttribute("aria-activedescendant", option("Spanish").element().id);

    await userEvent.keyboard("{Escape}");

    await expect.element(listbox()).not.toBeInTheDocument();
    await expect.element(subject()).toHaveTextContent("Reading");
    await expect.element(subject()).toHaveFocus();
  });

  it("opens on a typed letter and picks with Tab", async () => {
    const handleValueChange = vi.fn();
    await render(<FieldHarness onValueChange={handleValueChange} />);
    subject().element().focus();

    await userEvent.keyboard("w");
    await expect.element(listbox()).toBeVisible();
    await userEvent.tab();

    await expect.element(listbox()).not.toBeInTheDocument();
    expect(handleValueChange).toHaveBeenCalledWith("writing");
  });

  it("picks a clicked option and closes on a click outside", async () => {
    await render(<FieldHarness />);
    await userEvent.click(subject());
    await userEvent.click(option("Science"));

    await expect.element(subject()).toHaveTextContent("Science");
    await expect.element(subject()).toHaveFocus();

    await userEvent.click(subject());
    await expect.element(listbox()).toBeVisible();
    await userEvent.click(page.getByText("Outside"));

    await expect.element(listbox()).not.toBeInTheDocument();
    await expect.element(subject()).toHaveTextContent("Science");
    await expect.element(subject()).toHaveFocus();
  });

  it("shows the placeholder in the trigger but never as an option", async () => {
    await render(
      <KitRoot theme="light" height={KIT_HEIGHT}>
        <SelectField
          label="Subject"
          options={[{ value: "", label: "Pick a subject" }, ...SUBJECTS]}
          placeholder="Pick a subject"
        />
      </KitRoot>,
    );
    await expect.element(subject()).toHaveTextContent("Pick a subject");

    await userEvent.click(subject());

    await expect.element(option("Math")).toBeVisible();
    await expect.element(option("Pick a subject")).not.toBeInTheDocument();
  });

  it("doesn't open when disabled", async () => {
    await render(
      <KitRoot theme="light" height={KIT_HEIGHT}>
        <SelectField label="Subject" options={SUBJECTS} defaultValue="math" disabled />
      </KitRoot>,
    );
    await userEvent.click(subject(), { force: true });

    await expect.element(listbox()).not.toBeInTheDocument();
    await expect.element(subject()).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps its own value when uncontrolled", async () => {
    const handleChange = vi.fn();
    await render(
      <KitRoot theme="light" height={KIT_HEIGHT}>
        <SelectField
          label="Subject"
          options={SUBJECTS}
          defaultValue="math"
          onChange={handleChange}
        />
      </KitRoot>,
    );
    await expect.element(subject()).toHaveTextContent("Math");

    await userEvent.click(subject());
    await userEvent.click(option("Reading"));

    await expect.element(subject()).toHaveTextContent("Reading");
    expect(handleChange).toHaveBeenCalledWith({
      target: { value: "reading", name: undefined },
    });
  });

  it("matches the trigger's width, and is 200px at least", async () => {
    await render(
      <KitRoot theme="light" height={KIT_HEIGHT}>
        <div className="flex gap-6 p-6">
          <div className="w-[320px]">
            <SelectField label="Subject" options={SUBJECTS} />
          </div>
          <Select
            aria-label="Language"
            label="Language"
            options={SUBJECTS}
            defaultValue="math"
            variant="inline"
          />
        </div>
      </KitRoot>,
    );
    await userEvent.click(subject());
    await expect.element(listbox()).toBeVisible();
    expect(getBox(listbox().element()).width).toBe(
      getBox(subject().element()).width,
    );
    await userEvent.keyboard("{Escape}");

    const language = page.getByRole("combobox", { name: "Language" });
    await userEvent.click(language);

    await expect.element(listbox()).toBeVisible();
    expect(getBox(listbox().element()).width).toBe(POPOVER_MIN_WIDTH_PX);
  });

  it("widens past 200px to fit a long selected option", async () => {
    await render(<LanguageHarness languages={DETECTED_LANGUAGES} />);
    await userEvent.click(page.getByRole("combobox", { name: "Language" }));
    await expect.element(listbox()).toBeVisible();

    const label = option("Language not detected").element().querySelector("span");
    if (!label) throw new Error("option has no label");
    // The text's own box, so a fraction of a pixel lost still counts.
    const text = document.createRange();
    text.selectNodeContents(label);
    expect(text.getBoundingClientRect().width).toBeLessThanOrEqual(
      getBox(label).width,
    );
  });

  it("stops widening at 320px", async () => {
    const languages = [
      ...DETECTED_LANGUAGES,
      { value: "long", label: "A language name far too long for any popover" },
    ];
    await render(<LanguageHarness languages={languages} />);
    await userEvent.click(page.getByRole("combobox", { name: "Language" }));
    await expect.element(listbox()).toBeVisible();

    expect(getBox(listbox().element()).width).toBe(POPOVER_MAX_WIDTH_PX);
  });

  it("flips above the trigger when there's no room below", async () => {
    await render(
      <KitRoot theme="light" height={KIT_HEIGHT}>
        <div className="p-6 pt-[480px]">
          <SelectField label="Subject" options={SUBJECTS} defaultValue="math" />
        </div>
      </KitRoot>,
    );
    await userEvent.click(subject());

    await expect.element(listbox()).toBeVisible();
    // Polled: the enter animation starts the list 8px low.
    await expect
      .poll(() => getBox(listbox().element()).bottom)
      .toBeLessThan(getBox(subject().element()).top);
  });

  it.each<OverlayKind>(["dialog", "sheet"])(
    "opens over an open %s, picks there, and Escape closes only the list",
    async (kind) => {
      await render(<OverlayHarness kind={kind} />);
      const overlay = page.getByRole("dialog", { name: "Edit Booking" });
      await expect.element(overlay).toBeVisible();

      await userEvent.click(subject());
      await expect.element(option("Spanish")).toBeInViewport();
      await userEvent.click(option("Spanish"));

      await expect.element(subject()).toHaveTextContent("Spanish");
      await userEvent.keyboard("{ArrowDown}");
      await expect.element(listbox()).toBeVisible();
      await userEvent.keyboard("{Escape}");

      await expect.element(listbox()).not.toBeInTheDocument();
      await expect.element(overlay).toBeVisible();
      await expect.element(subject()).toHaveFocus();
    },
  );

  it.each<OverlayKind>(["dialog", "sheet"])(
    "inside an open %s, a press outside the list closes only the list",
    async (kind) => {
      await render(<OverlayHarness kind={kind} />);
      const overlay = page.getByRole("dialog", { name: "Edit Booking" });
      await userEvent.click(subject());
      await expect.element(listbox()).toBeVisible();

      const scrim = document.querySelector("[data-kit-overlay] .kit-fade");
      if (!scrim) throw new Error("The overlay rendered no scrim");
      await userEvent.click(page.elementLocator(scrim), {
        position: { x: 10, y: 10 },
      });

      await expect.element(listbox()).not.toBeInTheDocument();
      await expect.element(overlay).toBeVisible();
      await expect.element(subject()).toHaveFocus();

      await userEvent.click(subject());
      await expect.element(listbox()).toBeVisible();
      // The panel's bottom-left corner: plain content, clear of the list.
      const panelHeight = getBox(overlay.element()).height;
      await userEvent.click(overlay, {
        position: { x: 12, y: panelHeight - 12 },
      });

      await expect.element(listbox()).not.toBeInTheDocument();
      await expect.element(overlay).toBeVisible();
      await expect.element(subject()).toHaveFocus();
    },
  );

  it("closes the list on the first press of an overlay button, and the second press acts", async () => {
    const handleSave = vi.fn();
    await render(<OverlayHarness kind="dialog" onSave={handleSave} />);
    const save = page.getByRole("button", { name: "Save" });
    await userEvent.click(subject());
    await expect.element(listbox()).toBeVisible();

    await userEvent.click(save);

    await expect.element(listbox()).not.toBeInTheDocument();
    expect(handleSave).not.toHaveBeenCalled();

    await userEvent.click(save);

    expect(handleSave).toHaveBeenCalledOnce();
  });

  it("stops swallowing once a press ends in pointercancel (a touch that scrolled)", async () => {
    const handleSave = vi.fn();
    await render(<OverlayHarness kind="dialog" onSave={handleSave} />);
    const save = page.getByRole("button", { name: "Save" });
    await userEvent.click(subject());
    await expect.element(listbox()).toBeVisible();

    const pressed = save.element();
    pressed.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    pressed.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    await expect.element(listbox()).not.toBeInTheDocument();

    await userEvent.click(save);

    expect(handleSave).toHaveBeenCalledOnce();
  });

  it("swallows a tap's late compatibility click, so the scrim doesn't close the dialog", async () => {
    await render(<OverlayHarness kind="dialog" />);
    const overlay = page.getByRole("dialog", { name: "Edit Booking" });
    await userEvent.click(subject());
    await expect.element(listbox()).toBeVisible();
    const scrim = document.querySelector("[data-kit-overlay] .kit-fade");
    if (!scrim) throw new Error("The overlay rendered no scrim");

    const touch = { bubbles: true, pointerType: "touch" };
    scrim.dispatchEvent(new PointerEvent("pointerdown", touch));
    scrim.dispatchEvent(new PointerEvent("pointerup", touch));
    // Touch browsers send mousedown and click a little after pointerup.
    await new Promise((resolve) => setTimeout(resolve, TOUCH_CLICK_DELAY_MS));
    scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await expect.element(listbox()).not.toBeInTheDocument();
    await expect.element(overlay).toBeVisible();
  });

  it("closes, and stays closed, when its label is clicked while open", async () => {
    await render(<FieldHarness />);
    await userEvent.click(subject());
    await expect.element(listbox()).toBeVisible();

    await userEvent.click(page.getByText("Subject", { exact: true }));

    await expect.element(listbox()).not.toBeInTheDocument();
    await expect.element(subject()).toHaveFocus();
  });

  it("shrinks a flipped list to fit inside the kit when neither side has room", async () => {
    const hours = Array.from({ length: 12 }, (_, index) => ({
      value: String(index + 1),
      label: `${index + 1} o’clock`,
    }));
    await render(
      <KitRoot theme="light" height={KIT_HEIGHT}>
        <div className="px-6 pt-[254px]">
          <SelectField label="Subject" options={hours} defaultValue="1" />
        </div>
      </KitRoot>,
    );
    await userEvent.click(subject());
    await expect.element(listbox()).toBeVisible();

    const kit = document.querySelector("[data-kit]");
    if (!kit) throw new Error("KitRoot rendered no root");
    // Polled: the enter animation starts the list 8px low.
    await expect
      .poll(() => getBox(listbox().element()).bottom)
      .toBeLessThan(getBox(subject().element()).top);
    expect(getBox(listbox().element()).top).toBeGreaterThanOrEqual(
      getBox(kit).top + KIT_EDGE_INSET_PX,
    );
  });

  it("opens an empty list with a muted row and no options", async () => {
    const handleValueChange = vi.fn();
    await render(
      <KitRoot theme="light" height={KIT_HEIGHT}>
        <SelectField
          label="Subject"
          options={[]}
          placeholder="Pick a subject"
          onValueChange={handleValueChange}
        />
      </KitRoot>,
    );
    subject().element().focus();

    await userEvent.keyboard("{Home}");
    await expect.element(listbox()).toHaveTextContent("Nothing to pick.");
    await expect.element(page.getByRole("option")).not.toBeInTheDocument();
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");

    await expect.element(listbox()).not.toBeInTheDocument();
    await expect.element(subject()).toHaveTextContent("Pick a subject");
    expect(handleValueChange).not.toHaveBeenCalled();
  });

  describe("on a phone-width kit", () => {
    beforeEach(async () => {
      await page.viewport(PHONE_WIDTH, PHONE_HEIGHT);
    });

    const sheet = () => page.getByRole("dialog", { name: "Subject" });

    it("opens as a sheet titled with the label, and a pick closes it", async () => {
      const handleValueChange = vi.fn();
      await render(<FieldHarness onValueChange={handleValueChange} />);
      await userEvent.click(subject());

      await expect.element(sheet()).toBeVisible();
      await expect.element(option("Reading")).toHaveFocus();
      await userEvent.keyboard("{ArrowDown}");
      await expect.element(option("Writing")).toHaveFocus();
      await userEvent.keyboard("{Enter}");

      await expect.element(sheet()).not.toBeInTheDocument();
      await expect.element(subject()).toHaveTextContent("Writing");
      await expect.element(subject()).toHaveFocus();
      expect(handleValueChange).toHaveBeenCalledWith("writing");
    });

    it("closes on Escape or Close without changing the value", async () => {
      const handleValueChange = vi.fn();
      await render(<FieldHarness onValueChange={handleValueChange} />);
      await userEvent.click(subject());
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("{Escape}");

      await expect.element(sheet()).not.toBeInTheDocument();
      await expect.element(subject()).toHaveFocus();

      await userEvent.click(subject());
      await userEvent.click(page.getByRole("button", { name: "Close" }));

      await expect.element(sheet()).not.toBeInTheDocument();
      await expect.element(subject()).toHaveTextContent("Reading");
      await expect.element(subject()).toHaveFocus();
      expect(handleValueChange).not.toHaveBeenCalled();
    });

    it("centers the selected row of a long list in the sheet on open", async () => {
      await render(<LongListHarness hour={MIDDAY_HOUR} />);
      await userEvent.click(page.getByRole("combobox", { name: "Time" }));
      const midday = option(`Hour ${MIDDAY_HOUR}`);
      await expect.element(midday).toHaveFocus();

      const scroller = listbox().element().parentElement;
      if (!scroller) throw new Error("listbox has no scroller");
      const rowBox = getBox(midday.element());
      const scrollerBox = getBox(scroller);
      const rowCenter = rowBox.top + rowBox.height / 2;
      const scrollerCenter = scrollerBox.top + scrollerBox.height / 2;
      expect(Math.abs(rowCenter - scrollerCenter)).toBeLessThanOrEqual(1);
    });

    it("keeps the focused row of a long list in view, without scrolling the kit", async () => {
      await render(<LongListHarness hour={LATE_HOUR} />);
      await userEvent.click(page.getByRole("combobox", { name: "Time" }));
      const late = option(`Hour ${LATE_HOUR}`);
      await expect.element(late).toHaveFocus();
      expect(isShownInList(late.element())).toBe(true);

      await userEvent.keyboard("{Home}");
      for (let hour = 1; hour < HOURS.length; hour++) {
        await userEvent.keyboard("{ArrowDown}");
        const row = option(`Hour ${hour}`);
        await expect.element(row).toHaveFocus();
        expect(isShownInList(row.element()), `Hour ${hour}`).toBe(true);
      }
      expect(getKitScrollTops().every((top) => top === 0)).toBe(true);
    });

    it("picks a tapped option inside an open sheet, leaving that sheet open", async () => {
      await render(<OverlayHarness kind="sheet" />);
      await userEvent.click(subject());
      await expect.element(sheet()).toBeVisible();

      await userEvent.click(option("Science"));

      await expect.element(sheet()).not.toBeInTheDocument();
      await expect
        .element(page.getByRole("dialog", { name: "Edit Booking" }))
        .toBeVisible();
      await expect.element(subject()).toHaveTextContent("Science");
      await expect.element(subject()).toHaveFocus();
    });
  });
});
