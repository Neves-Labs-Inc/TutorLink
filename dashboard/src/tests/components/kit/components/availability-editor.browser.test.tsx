import { useState } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { AvailabilityEditor } from "@/components/kit/components/availability-editor";
import type { AvailabilitySlot } from "@/components/kit/types/domain";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 800 };
const NARROW_PHONE = { width: 320, height: 640 };
const TAB_BAR_CLEARANCE = "92px";
const OVERLAY_CLEARANCE = "16px";
// The Manager profile caps its sections at 720px.
const PROFILE_SECTION_WIDTH = 720;
const MIN_LOCATION_WIDTH = 160;

const WEEK: AvailabilitySlot[] = [
  {
    id: "mon-1",
    day: "Monday",
    from: "15:00",
    to: "18:00",
    location: "Home visits",
  },
  {
    id: "wed-1",
    day: "Wednesday",
    from: "09:00",
    to: "11:00",
    location: "Office only",
  },
];

type SaveWeek = (slots: AvailabilitySlot[]) => Promise<void>;

type HarnessProps = {
  initialSlots?: AvailabilitySlot[];
  onSave?: (slots: AvailabilitySlot[]) => Promise<void> | void;
  isReadOnly?: boolean;
  ownerName?: string;
  isInOverlay?: boolean;
  hostWidth?: number;
};

// The editor is controlled: the harness takes the saved week as its new
// slots, the way the real section does once the PUT answers.
function Harness({
  initialSlots = WEEK,
  onSave = async () => {},
  isReadOnly,
  ownerName,
  isInOverlay,
  hostWidth,
}: HarnessProps): ReactNode {
  const [slots, setSlots] = useState(initialSlots);

  async function handleSave(next: AvailabilitySlot[]): Promise<void> {
    await onSave(next);
    setSlots(next);
  }

  return (
    <KitRoot theme="light">
      <div className="p-4" style={{ width: hostWidth }}>
        <AvailabilityEditor
          slots={slots}
          onSave={handleSave}
          isReadOnly={isReadOnly}
          ownerName={ownerName}
          isInOverlay={isInOverlay}
        />
      </div>
    </KitRoot>
  );
}

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

const editButton = () => page.getByRole("button", { name: "Edit" });
const saveButton = () => page.getByRole("button", { name: "Save" });
const cancelButton = () => page.getByRole("button", { name: "Cancel" });
const mondayEnd = () => page.getByLabelText("Monday range 1 ends");

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

describe("read-only week", () => {
  it("shows the summary, each range and the days without any", async () => {
    await render(<Harness />);
    await expect
      .element(page.getByText("2 time ranges · about 5 hours a week"))
      .toBeVisible();
    await expect.element(page.getByText("3:00 PM – 6:00 PM")).toBeVisible();
    await expect.element(page.getByText("Home visits")).toBeVisible();
    expect(page.getByText("Not available").elements()).toHaveLength(5);
  });

  it("reads one range in the singular", async () => {
    await render(<Harness initialSlots={[WEEK[0]]} />);
    await expect
      .element(page.getByText("1 time range · about 3 hours a week"))
      .toBeVisible();
  });

  it("reads No time ranges yet for an empty week", async () => {
    await render(<Harness initialSlots={[]} />);
    await expect.element(page.getByText("No time ranges yet")).toBeVisible();
    expect(page.getByText(/0 time ranges/).elements()).toHaveLength(0);
  });

  it("has no Edit when read-only, but keeps the summary", async () => {
    await render(<Harness isReadOnly />);
    await expect
      .element(page.getByText("2 time ranges · about 5 hours a week"))
      .toBeVisible();
    expect(editButton().elements()).toHaveLength(0);
  });
});

describe("editing", () => {
  it("opens the whole week and moves focus to the first day's first control", async () => {
    await render(<Harness />);
    await editButton().click();
    await expect
      .element(
        page.getByText("Editing your whole week. Nothing changes until you save."),
      )
      .toBeVisible();
    await expect
      .element(page.getByLabelText("Monday range 1 starts"))
      .toHaveFocus();
  });

  it("focuses Add a time range when the first day has none", async () => {
    await render(<Harness initialSlots={[WEEK[1]]} />);
    await editButton().click();
    await expect
      .element(page.getByRole("button", { name: "Add a time range" }).first())
      .toHaveFocus();
  });

  it("names the owner when it is someone else's week", async () => {
    await render(<Harness ownerName="Marco" />);
    await editButton().click();
    await expect
      .element(
        page.getByText(
          "Editing Marco’s whole week. Nothing changes until you save.",
        ),
      )
      .toBeVisible();
  });

  it("adds and removes ranges", async () => {
    const onSave = vi.fn<SaveWeek>(async () => {});
    await render(<Harness onSave={onSave} />);
    await editButton().click();
    await page.getByRole("button", { name: "Add a time range" }).first().click();
    await page.getByRole("button", { name: "Remove Monday range 1" }).click();
    await saveButton().click();

    const [saved] = onSave.mock.calls[0];
    expect(saved.map((slot) => [slot.day, slot.from, slot.to])).toEqual([
      ["Tuesday", "15:00", "18:00"],
      ["Wednesday", "09:00", "11:00"],
    ]);
  });

  it("changes a range's location", async () => {
    const onSave = vi.fn<SaveWeek>(async () => {});
    await render(<Harness onSave={onSave} />);
    await editButton().click();
    await page.getByRole("combobox", { name: "Monday range 1 location" }).click();
    await page.getByRole("option", { name: "Office only", exact: true }).click();
    await saveButton().click();

    const [saved] = onSave.mock.calls[0];
    expect(saved[0].location).toBe("Office only");
  });

  it("copies a day's ranges to other days", async () => {
    const onSave = vi.fn<SaveWeek>(async () => {});
    await render(<Harness onSave={onSave} />);
    await editButton().click();
    await page.getByRole("button", { name: "Copy to…" }).first().click();
    await page.getByRole("checkbox", { name: "Friday" }).click();
    await page.getByRole("button", { name: "Copy to 1 day" }).click();
    await saveButton().click();

    const [saved] = onSave.mock.calls[0];
    expect(saved.map((slot) => slot.day)).toEqual([
      "Monday",
      "Wednesday",
      "Friday",
    ]);
  });

  it("blocks Save while a range ends before it starts", async () => {
    await render(<Harness />);
    await editButton().click();
    await mondayEnd().fill("14:00");
    await expect
      .element(page.getByText("Fix 1 range that ends before it starts."))
      .toBeVisible();
    await expect
      .element(page.getByText("Ends before it starts. Pick a later end time."))
      .toBeVisible();
    await expect.element(saveButton()).toBeDisabled();
  });

  it("drops the edits on Cancel and puts focus back on Edit", async () => {
    await render(<Harness />);
    await editButton().click();
    await page.getByRole("button", { name: "Remove Monday range 1" }).click();
    await cancelButton().click();

    await expect.element(page.getByText("3:00 PM – 6:00 PM")).toBeVisible();
    await expect.element(editButton()).toHaveFocus();
  });
});

describe("async save", () => {
  it("shows Save loading and disables every control while it runs", async () => {
    const save = deferred();
    await render(<Harness onSave={() => save.promise} />);
    await editButton().click();
    await saveButton().click();

    await expect.element(saveButton()).toHaveAttribute("aria-busy", "true");
    await expect.element(saveButton()).toBeDisabled();
    await expect.element(cancelButton()).toBeDisabled();
    await expect.element(page.getByLabelText("Monday range 1 starts")).toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Remove Monday range 1" }))
      .toBeDisabled();
    await expect
      .element(page.getByRole("button", { name: "Add another" }).first())
      .toBeDisabled();
    save.resolve();
  });

  it("goes back to read-only with the saved week and focuses Edit", async () => {
    const save = deferred();
    await render(<Harness onSave={() => save.promise} />);
    await editButton().click();
    await mondayEnd().fill("19:00");
    await saveButton().click();
    save.resolve();

    await expect.element(page.getByText("3:00 PM – 7:00 PM")).toBeVisible();
    await expect.element(editButton()).toHaveFocus();
    expect(saveButton().elements()).toHaveLength(0);
  });

  it("keeps the edits and shows the alert when the save fails", async () => {
    const save = deferred();
    await render(<Harness onSave={() => save.promise} />);
    await editButton().click();
    await mondayEnd().fill("19:00");
    await saveButton().click();
    save.reject(new Error("500"));

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent(
        "Couldn’t save the availability. Check your connection and try again.",
      );
    await expect.element(mondayEnd()).toHaveValue("19:00");
    await expect.element(saveButton()).toBeEnabled();
    await expect.element(saveButton()).toHaveFocus();
  });

  it("clears the save error on Cancel", async () => {
    await render(
      <Harness onSave={() => Promise.reject(new Error("500"))} />,
    );
    await editButton().click();
    await saveButton().click();
    await expect.element(page.getByRole("alert")).toBeVisible();
    await cancelButton().click();
    await editButton().click();

    expect(page.getByRole("alert").elements()).toHaveLength(0);
  });
});

describe("layout", () => {
  it("stacks the edit row at 390: times, then location and remove", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await render(<Harness />);
    await editButton().click();

    const start = page.getByLabelText("Monday range 1 starts").element();
    const remove = page
      .getByRole("button", { name: "Remove Monday range 1" })
      .element();
    expect(remove.getBoundingClientRect().top).toBeGreaterThan(
      start.getBoundingClientRect().bottom,
    );
  });

  it("stacks the edit row in a 720px host so the location stays readable", async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    await render(<Harness hostWidth={PROFILE_SECTION_WIDTH} />);
    await editButton().click();

    const location = page
      .getByRole("combobox", { name: "Monday range 1 location" })
      .element();
    expect(location.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      MIN_LOCATION_WIDTH,
    );
    await expect
      .element(page.getByRole("combobox", { name: "Monday range 1 location" }))
      .toHaveTextContent("Home visits");
  });

  it("keeps the edit row on one line when the ranges column is wide", async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
    await render(<Harness />);
    await editButton().click();

    const start = page.getByLabelText("Monday range 1 starts").element();
    const remove = page
      .getByRole("button", { name: "Remove Monday range 1" })
      .element();
    expect(remove.getBoundingClientRect().top).toBeLessThan(
      start.getBoundingClientRect().bottom,
    );
  });

  it("sticks the save bar above the tab bar on phones", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await render(<Harness />);
    await editButton().click();

    const bar = saveButton().element().closest("[data-save-bar]");
    expect(bar).not.toBeNull();
    expect(getComputedStyle(bar as Element).bottom).toBe(TAB_BAR_CLEARANCE);
  });

  it("sticks the save bar at 16px inside an overlay", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await render(<Harness isInOverlay />);
    await editButton().click();

    const bar = saveButton().element().closest("[data-save-bar]");
    expect(getComputedStyle(bar as Element).bottom).toBe(OVERLAY_CLEARANCE);
  });

  it("shows the save error at phone width", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await render(
      <Harness onSave={() => Promise.reject(new Error("500"))} />,
    );
    await editButton().click();
    await saveButton().click();

    await expect.element(page.getByRole("alert")).toBeVisible();
  });

  it("never scrolls sideways at 320", async () => {
    await page.viewport(NARROW_PHONE.width, NARROW_PHONE.height);
    await render(<Harness />);
    await editButton().click();

    const scroller = document.querySelector("[data-kit-scroll]");
    expect(scroller?.scrollWidth).toBeLessThanOrEqual(NARROW_PHONE.width);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      NARROW_PHONE.width,
    );
  });
});

describe("keyboard", () => {
  it("opens the week from Edit with Enter after a Cancel", async () => {
    await render(<Harness />);
    await editButton().click();
    await cancelButton().click();
    await expect.element(editButton()).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByLabelText("Monday range 1 starts"))
      .toHaveFocus();
  });
});
