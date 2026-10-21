import { useState } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { SaveBar } from "@/components/kit/components/save-bar";
import type { SaveState } from "@/components/kit/components/save-bar";
import { SectionCard } from "@/components/kit/components/section-card";
import { SectionIndex } from "@/components/kit/components/section-index";
import {
  DurationField,
  FieldFrame,
  StepperField,
} from "@/components/kit/components/settings-form";
import { HOURS_UNITS } from "@/components/kit/lib/units";

const KIT_HEIGHT = "600px";
const PHONE_WIDTH = 375;
// One cell of the @3xl two-up card grid in the 448px content column at 1024px.
const NARROW_CELL_WIDTH = 191;

function Frame({ children }: { children: ReactNode }): ReactNode {
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <div className="p-6">{children}</div>
    </KitRoot>
  );
}

type BarProps = {
  changeCount?: number;
  hasErrors?: boolean;
  saveState?: SaveState;
  onSave?: () => void;
  onDiscard?: () => void;
};

function renderBar({
  changeCount = 3,
  hasErrors = false,
  saveState = "idle",
  onSave = () => undefined,
  onDiscard = () => undefined,
}: BarProps = {}) {
  return render(
    <Frame>
      <SaveBar
        changeCount={changeCount}
        hasErrors={hasErrors}
        saveState={saveState}
        onSave={onSave}
        onDiscard={onDiscard}
      />
    </Frame>,
  );
}

describe("SaveBar", () => {
  it("is not rendered at zero changes", async () => {
    await renderBar({ changeCount: 0 });
    await expect.element(page.getByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
  });

  it("counts the changes, singular and plural", async () => {
    const screen = await renderBar({ changeCount: 1 });
    await expect.element(page.getByRole("status")).toHaveTextContent("1 unsaved change");
    await screen.rerender(
      <Frame>
        <SaveBar changeCount={3} hasErrors={false} saveState="idle" onSave={vi.fn()} onDiscard={vi.fn()} />
      </Frame>,
    );
    await expect.element(page.getByRole("status")).toHaveTextContent("3 unsaved changes");
  });

  it("asks to fix the field and blocks Save when there are errors", async () => {
    await renderBar({ hasErrors: true });
    await expect.element(page.getByRole("status")).toHaveTextContent("Fix the highlighted field to save.");
    await expect.element(page.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("says the save failed and keeps both buttons live", async () => {
    await renderBar({ saveState: "failed" });
    await expect.element(page.getByRole("status")).toHaveTextContent(
      "Couldn’t save. Check your connection and try again.",
    );
    await expect.element(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
    await expect.element(page.getByRole("button", { name: "Discard" })).toBeEnabled();
  });

  it("shows Saving… and disables Discard while saving", async () => {
    await renderBar({ saveState: "saving" });
    await expect.element(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Discard" })).toBeDisabled();
  });

  it("calls Save and Discard", async () => {
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    await renderBar({ onSave, onDiscard });
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByRole("button", { name: "Discard" }).click();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("stays on one row in a 448px column", async () => {
    await render(
      <KitRoot theme="light" height={KIT_HEIGHT}>
        <div style={{ width: 448 }}>
          <SaveBar changeCount={3} hasErrors={false} saveState="idle" onSave={vi.fn()} onDiscard={vi.fn()} />
        </div>
      </KitRoot>,
    );
    const region = page.getByRole("region", { name: "Unsaved changes" }).element();
    expect(region.getBoundingClientRect().height).toBeLessThan(70);
  });

  it("uses the 28px radius", async () => {
    await renderBar();
    const region = page.getByRole("region", { name: "Unsaved changes" }).element();
    expect(getComputedStyle(region).borderTopLeftRadius).toBe("28px");
  });
});

describe("SectionCard", () => {
  function Card(): ReactNode {
    return (
      <Frame>
        <SectionCard id="sign-in" title="Sign-in protection" description="Applies to everyone." isCollapsible>
          <p>Tries allowed</p>
        </SectionCard>
      </Frame>
    );
  }

  it("starts collapsed and opens and closes from the head", async () => {
    await render(<Card />);
    const head = page.getByRole("button", { name: /Sign-in protection/ });
    await expect.element(head).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByText("Tries allowed")).not.toBeInTheDocument();
    await expect.element(page.getByRole("heading", { name: /Sign-in protection/ })).toBeVisible();
    await head.click();
    await expect.element(head).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByText("Tries allowed")).toBeVisible();
    await head.click();
    await expect.element(page.getByText("Tries allowed")).not.toBeInTheDocument();
  });

  it("always shows a non-collapsible body", async () => {
    await render(
      <Frame>
        <SectionCard id="office" title="Office" description="Where.">
          <p>Office phone</p>
        </SectionCard>
      </Frame>,
    );
    await expect.element(page.getByText("Office phone")).toBeVisible();
    await expect.element(page.getByRole("button")).not.toBeInTheDocument();
  });
});

describe("SectionIndex", () => {
  const sections = [
    { id: "booking-rules", title: "Booking rules", count: 2 },
    { id: "office", title: "Office", count: 0 },
  ];

  function Page({ layout }: { layout: "row" | "column" }): ReactNode {
    return (
      <Frame>
        <SectionIndex label="Settings groups" sections={sections} layout={layout} />
        <div style={{ height: 900 }} />
        <SectionCard id="office" title="Office" description="Where.">
          <p>Body</p>
        </SectionCard>
      </Frame>
    );
  }

  it("shows the unsaved count only for groups that have changes", async () => {
    await render(<Page layout="row" />);
    await expect.element(page.getByRole("button", { name: /Booking rules/ })).toHaveTextContent(
      "2 unsaved changes",
    );
    await expect.element(page.getByRole("button", { name: "Office" })).not.toHaveTextContent("unsaved");
  });

  it("scrolls to the group and focuses its heading", async () => {
    await render(<Page layout="row" />);
    await page.getByRole("button", { name: "Office" }).click();
    await expect.element(page.getByRole("heading", { name: "Office" })).toHaveFocus();
  });

  it("jumps instantly under reduced motion", async () => {
    await page.viewport(PHONE_WIDTH, 800);
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation(
      (query) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
    );
    await render(<Page layout="row" />);
    await page.getByRole("button", { name: "Office" }).click();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    scrollIntoView.mockRestore();
    matchMedia.mockRestore();
  });
});

describe("FieldFrame", () => {
  it("wires help and the Changed tag into aria-describedby", async () => {
    await render(
      <Frame>
        <FieldFrame label="Session length" help="How long each Booking lasts." isChanged>
          {({ controlId, describedBy }) => <input id={controlId} aria-describedby={describedBy} />}
        </FieldFrame>
      </Frame>,
    );
    const input = page.getByRole("textbox", { name: "Session length" });
    await expect.element(input).toHaveAccessibleDescription("Changed How long each Booking lasts.");
    const tag = page.getByText("Changed");
    expect(getComputedStyle(tag.element()).fontSize).toBe("12px");
  });

  it("shows the error in place of the help", async () => {
    await render(
      <Frame>
        <FieldFrame label="Session length" help="Help text" error="Too long">
          {({ controlId, describedBy }) => <input id={controlId} aria-describedby={describedBy} />}
        </FieldFrame>
      </Frame>,
    );
    await expect.element(page.getByText("Help text")).not.toBeInTheDocument();
    await expect.element(page.getByRole("textbox")).toHaveAccessibleDescription("Too long");
  });

  it("labels the fieldset in group mode", async () => {
    await render(
      <Frame>
        <FieldFrame label="Session length" isGroup>
          {() => <input aria-label="amount" />}
        </FieldFrame>
      </Frame>,
    );
    await expect.element(page.getByRole("group", { name: "Session length" })).toBeVisible();
  });
});

describe("number fields", () => {
  function Duration(): ReactNode {
    const [value, setValue] = useState("48");
    return (
      <Frame>
        <DurationField label="Look ahead" value={value} units={HOURS_UNITS} onChange={setValue} />
        <output data-testid="stored">{value}</output>
      </Frame>
    );
  }

  it("shows the stored value as number plus unit and writes the base value back", async () => {
    await render(<Duration />);
    const amount = page.getByRole("textbox", { name: "Look ahead" });
    await expect.element(amount).toHaveValue("2");
    await expect.element(page.getByRole("combobox", { name: "Look ahead, unit" })).toHaveTextContent("days");
    await userEvent.fill(amount.element() as HTMLElement, "3");
    await expect.element(page.getByTestId("stored")).toHaveTextContent("72");
  });

  it("returns to the natural unit when the value is reset from outside", async () => {
    function Resettable(): ReactNode {
      const [value, setValue] = useState("5");
      return (
        <Frame>
          <DurationField label="Look ahead" value={value} units={HOURS_UNITS} onChange={setValue} />
          <button type="button" onClick={() => setValue("5")}>Reset</button>
        </Frame>
      );
    }
    await render(<Resettable />);
    await page.getByRole("combobox", { name: "Look ahead, unit" }).click();
    await page.getByRole("option", { name: "days" }).click();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect.element(page.getByRole("textbox", { name: "Look ahead" })).toHaveValue("5");
    await expect.element(page.getByRole("combobox", { name: "Look ahead, unit" })).toHaveTextContent("hours");
  });

  it("keeps the amount at 96px and the unit Select visible at 375px", async () => {
    await page.viewport(PHONE_WIDTH, 800);
    await render(
      <KitRoot theme="light" height={KIT_HEIGHT}>
        <div className="p-4">
          <DurationField label="Look ahead" value="48" units={HOURS_UNITS} onChange={() => undefined} />
        </div>
      </KitRoot>,
    );
    const amount = page.getByRole("textbox", { name: "Look ahead" }).element();
    const unit = page.getByRole("combobox", { name: "Look ahead, unit" }).element();
    expect(amount.getBoundingClientRect().width).toBe(96);
    expect(unit.getBoundingClientRect().width).toBeGreaterThan(0);
    const scroller = amount.closest("[data-kit-scroll]") ?? document.documentElement;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
  });

  it("keeps the stepper input at 80px", async () => {
    await render(
      <Frame>
        <StepperField label="Times offered" value="3" min={1} suffix="times" onChange={() => undefined} />
      </Frame>,
    );
    const input = page.getByRole("textbox", { name: "Times offered" }).element();
    expect(input.getBoundingClientRect().width).toBe(80);
  });

  it("keeps the stepper row inside a 191px two-up cell", async () => {
    await render(
      <Frame>
        <div data-testid="cell" style={{ width: NARROW_CELL_WIDTH }}>
          <StepperField label="Reminders" value="3" min={1} suffix="reminders" onChange={() => undefined} />
        </div>
      </Frame>,
    );
    const cellRight = page.getByTestId("cell").element().getBoundingClientRect().right;
    const suffix = page.getByText("reminders", { exact: true }).element();
    expect(suffix.getBoundingClientRect().right).toBeLessThanOrEqual(cellRight);
    const input = page.getByRole("textbox", { name: "Reminders" }).element();
    expect(input.getBoundingClientRect().width).toBe(80);
    const scroller = input.closest("[data-kit-scroll]") ?? document.documentElement;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
  });

  it("steps within its bounds", async () => {
    function Stepper(): ReactNode {
      const [value, setValue] = useState("1");
      return (
        <Frame>
          <StepperField label="Times offered" value={value} min={1} max={2} suffix="times" onChange={setValue} />
        </Frame>
      );
    }
    await render(<Stepper />);
    await expect.element(page.getByRole("button", { name: "Fewer times" })).toBeDisabled();
    await page.getByRole("button", { name: "More times" }).click();
    await expect.element(page.getByRole("textbox", { name: "Times offered" })).toHaveValue("2");
    await expect.element(page.getByRole("button", { name: "More times" })).toBeDisabled();
  });
});
