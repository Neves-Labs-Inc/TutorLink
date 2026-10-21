import { useState } from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cdp, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { Combobox } from "@/components/kit/components/combobox";
import { MultiSelectFilter } from "@/components/kit/components/multi-select-filter";
import Select from "@/components/kit/components/select";
import { BottomSheet } from "@/components/kit/overlays/bottom-sheet";
import { DetailOverlay } from "@/components/kit/overlays/detail-overlay";
import { ConfirmDialog, Dialog } from "@/components/kit/overlays/dialog";
import { useToast } from "@/components/kit/overlays/use-toast";

const DESKTOP_WIDTH = 1280;
const PHONE_WIDTH = 375;
const VIEWPORT_HEIGHT = 800;
const KIT_HEIGHT = "600px";
const EXIT_MS = 160;
const EXIT_EASING = "cubic-bezier(0.4, 0, 1, 1)";
const KIT_RISE_MS = 220;
// Comfortably past the 160ms exit (and a slow CI frame or two).
const EXIT_SETTLED_MS = 400;
const OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
];

type OverlayKind = "dialog" | "sheet" | "detail";

type OverlayProps = {
  kind: OverlayKind;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
};

function Overlay({ kind, isOpen, onClose, children }: OverlayProps): ReactNode {
  if (kind === "dialog") {
    return (
      <Dialog isOpen={isOpen} onClose={onClose} title="Overlay" footer={null}>
        {children}
      </Dialog>
    );
  }
  if (kind === "sheet") {
    return (
      <BottomSheet isOpen={isOpen} onClose={onClose} title="Overlay">
        {children}
      </BottomSheet>
    );
  }
  return (
    <DetailOverlay
      isOpen={isOpen}
      onClose={onClose}
      title="Overlay"
      backLabel="Back"
      phoneMode="page"
    >
      {children}
    </DetailOverlay>
  );
}

type HarnessProps = { kind?: OverlayKind };

function Harness({ kind = "dialog" }: HarnessProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [clicks, setClicks] = useState(0);
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <button type="button" onClick={() => setIsOpen(true)}>
        Open overlay
      </button>
      <button type="button" onClick={() => setClicks(clicks + 1)}>
        Page clicks {clicks}
      </button>
      <Overlay kind={kind} isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <button type="button" onClick={() => setIsConfirmOpen(true)}>
          Open confirm
        </button>
      </Overlay>
      <ConfirmDialog
        isOpen={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        onConfirm={() => setIsConfirmOpen(false)}
        title="Sure?"
        confirmLabel="Yes, do it"
        keepLabel="Not yet"
      >
        This can’t be undone.
      </ConfirmDialog>
    </KitRoot>
  );
}

function ToastHarness(): ReactNode {
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <ToastButton />
    </KitRoot>
  );
}

function ToastButton(): ReactNode {
  const { showToast } = useToast();
  const [count, setCount] = useState(0);
  function handleClick(): void {
    const next = count + 1;
    setCount(next);
    showToast({ tone: "success", message: `Toast ${next}` });
  }
  return (
    <button type="button" onClick={handleClick}>
      Show toast
    </button>
  );
}

function PickerHarness(): ReactNode {
  const [selected, setSelected] = useState<string[]>([]);
  const [value, setValue] = useState<string | null>(null);
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <div className="flex flex-col gap-4 p-6">
        <Select aria-label="Status" options={OPTIONS} defaultValue="draft" />
        <MultiSelectFilter
          label="Kind"
          options={OPTIONS}
          selected={selected}
          onChange={setSelected}
        />
        <Combobox
          label="Person"
          options={OPTIONS}
          value={value}
          onChange={setValue}
        />
      </div>
    </KitRoot>
  );
}

type Item = { name: string; note: string };

const ITEM: Item = { name: "Maths with Ana", note: "Tuesday at 4pm" };

// Like the app's screens: the overlay is open while an item is picked,
// and its content comes from that item, which clears on close.
function ItemHarness(): ReactNode {
  const [detail, setDetail] = useState<Item | null>(null);
  const [toDecline, setToDecline] = useState<Item | null>(null);
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <button type="button" onClick={() => setDetail(ITEM)}>
        Open detail
      </button>
      <button type="button" onClick={() => setToDecline(ITEM)}>
        Open decline
      </button>
      <DetailOverlay
        isOpen={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.name ?? "Booking"}
        backLabel="Back"
        phoneMode="page"
        header={<h2>{detail?.name}</h2>}
        footer={<span>{detail?.note}</span>}
      >
        <p>{detail?.note}</p>
      </DetailOverlay>
      <ConfirmDialog
        isOpen={toDecline !== null}
        onClose={() => setToDecline(null)}
        onConfirm={() => setToDecline(null)}
        title={`Decline ${toDecline?.name ?? ""}?`}
        confirmLabel="Decline"
        keepLabel="Keep"
      >
        {toDecline?.note}
      </ConfirmDialog>
    </KitRoot>
  );
}

function ComboboxInSheetHarness(): ReactNode {
  const [value, setValue] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      <BottomSheet
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="New booking"
      >
        <Combobox
          label="Person"
          options={OPTIONS}
          value={value}
          onChange={setValue}
        />
      </BottomSheet>
    </KitRoot>
  );
}

const opener = () => page.getByRole("button", { name: "Open overlay" });
const overlay = () => page.getByRole("dialog", { name: "Overlay" });
const confirm = () => page.getByRole("dialog", { name: "Sure?" });

function getLayer(panel: Element): HTMLElement {
  const layer = panel.closest<HTMLElement>("[data-kit-overlay]");
  if (!layer) throw new Error("Panel is not inside an overlay layer");
  return layer;
}

function getExit(element: Element): Animation {
  const exit = element
    .getAnimations()
    .find((animation) => animation.effect?.getTiming().duration === EXIT_MS);
  if (!exit) throw new Error("No exit animation is playing");
  return exit;
}

function getFrames(animation: Animation): ComputedKeyframe[] {
  const effect = animation.effect;
  if (!(effect instanceof KeyframeEffect)) throw new Error("Not a keyframe effect");
  return effect.getKeyframes();
}

function getScrim(panel: Element): Element {
  const scrim = panel.previousElementSibling;
  if (!scrim) throw new Error("Panel has no scrim");
  return scrim;
}

async function openSettled(): Promise<HTMLElement> {
  await userEvent.click(opener());
  await expect.element(overlay()).toBeVisible();
  const panel = overlay().element() as HTMLElement;
  await Promise.all(panel.getAnimations().map((animation) => animation.finished));
  return panel;
}

// Clicks the opener in the same microtask run as usePresence's own
// exit-finished handler (registered first, so it runs first), before
// React commits the unmount: the window a busy page can land a reopen in.
async function reopenAsExitFinishes(panel: Element): Promise<void> {
  const exit = getExit(panel);
  await exit.finished.then(() => {
    (opener().element() as HTMLElement).click();
  });
  await expect.element(overlay()).toBeVisible();
  expect(overlay().element()).toBe(panel);
}

// Waits out the enter, then checks the panel and its scrim are fully
// shown and every edge of the panel sits inside the kit root.
async function expectSettledInsideKit(panel: Element): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, EXIT_SETTLED_MS));
  expect(window.getComputedStyle(panel).opacity).toBe("1");
  expect(window.getComputedStyle(getScrim(panel)).opacity).toBe("1");
  const kit = panel.closest("[data-kit]");
  if (!kit) throw new Error("Panel is not inside a kit root");
  const box = panel.getBoundingClientRect();
  const kitBox = kit.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.left).toBeGreaterThanOrEqual(kitBox.left);
  expect(box.right).toBeLessThanOrEqual(kitBox.right);
  expect(box.top).toBeGreaterThanOrEqual(kitBox.top);
  expect(box.bottom).toBeLessThanOrEqual(kitBox.bottom);
}

async function setReducedMotion(isReduced: boolean): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-reduced-motion", value: isReduced ? "reduce" : "" },
    ],
  });
}

describe("kit overlay exits", () => {
  beforeEach(async () => {
    await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT);
  });

  afterEach(async () => {
    await setReducedMotion(false);
  });

  it("plays a dialog's enter in reverse over 160ms, easing in, with its scrim", async () => {
    await render(<Harness />);
    const panel = await openSettled();

    await userEvent.keyboard("{Escape}");

    const exit = getExit(panel);
    expect(exit.effect?.getTiming().easing).toBe(EXIT_EASING);
    const [first, last] = getFrames(exit);
    expect(first).toMatchObject({ opacity: "1", transform: "scale(1)" });
    expect(last).toMatchObject({ opacity: "0", transform: "scale(0.96)" });
    const scrimExit = getExit(getScrim(panel));
    expect(scrimExit.effect?.getTiming().easing).toBe(EXIT_EASING);
    expect(getFrames(scrimExit).at(-1)).toMatchObject({ opacity: "0" });
  });

  it("returns focus to the opener as soon as the close starts", async () => {
    await render(<Harness />);
    const panel = await openSettled();

    await userEvent.keyboard("{Escape}");

    expect(panel.isConnected).toBe(true);
    expect(document.activeElement).toBe(opener().element());
  });

  it("leaves the closing layer inert while the page takes clicks", async () => {
    await render(<Harness />);
    const panel = await openSettled();

    await userEvent.keyboard("{Escape}");

    const layer = getLayer(panel);
    expect(layer.inert).toBe(true);
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    await userEvent.click(page.getByRole("button", { name: /Page clicks/ }));
    await expect
      .element(page.getByRole("button", { name: "Page clicks 1" }))
      .toBeInTheDocument();
  });

  it("unmounts the overlay once its exit has played", async () => {
    await render(<Harness />);
    const panel = await openSettled();

    await userEvent.keyboard("{Escape}");
    expect(panel.isConnected).toBe(true);

    await expect.poll(() => panel.isConnected).toBe(false);
  });

  it("lets Escape close the lower overlay while the top one is still leaving", async () => {
    await render(<Harness />);
    await openSettled();
    await userEvent.click(page.getByRole("button", { name: "Open confirm" }));
    await expect.element(confirm()).toBeVisible();
    const confirmPanel = confirm().element();

    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");

    expect(confirmPanel.isConnected).toBe(true);
    await expect.element(overlay()).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener().element());
  });

  it("reopens cleanly when opened again mid-exit", async () => {
    await render(<Harness />);
    const panel = await openSettled();

    await userEvent.keyboard("{Escape}");
    // Hold the exit mid-way: on a slow run it could finish and unmount the
    // panel before the click lands.
    await expect.poll(() => getExit(panel)).toBeTruthy();
    getExit(panel).pause();
    await userEvent.click(opener());

    await expect.element(overlay()).toBeVisible();
    expect(overlay().element()).toBe(panel);
    expect(getLayer(panel).inert).toBe(false);
    expect(panel.contains(document.activeElement)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, EXIT_SETTLED_MS));
    await expect.element(overlay()).toBeVisible();
  });

  describe("reopened before unmount", () => {
    it.each<OverlayKind>(["dialog", "sheet", "detail"])(
      "settles a %s inside the kit when reopened as its exit finishes",
      async (kind) => {
        await render(<Harness kind={kind} />);
        const panel = await openSettled();

        await userEvent.keyboard("{Escape}");
        await reopenAsExitFinishes(panel);

        await expectSettledInsideKit(panel);
      },
    );

    it("lets the reopened detail close again", async () => {
      await render(<Harness kind="detail" />);
      const panel = await openSettled();

      await userEvent.keyboard("{Escape}");
      await reopenAsExitFinishes(panel);
      await expectSettledInsideKit(panel);
      await userEvent.click(overlay().getByRole("button", { name: "Close" }));

      await expect.element(overlay()).not.toBeInTheDocument();
    });

    it("settles a detail closed on a phone and reopened mid-exit on a wide kit", async () => {
      await page.viewport(PHONE_WIDTH, VIEWPORT_HEIGHT);
      await render(<Harness kind="detail" />);
      const panel = await openSettled();

      await userEvent.keyboard("{Escape}");
      getExit(panel).pause();
      await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT);
      await userEvent.click(opener());

      await expectSettledInsideKit(panel);
      await userEvent.click(overlay().getByRole("button", { name: "Close" }));
      await expect.element(overlay()).not.toBeInTheDocument();
    });

    it("settles a detail closed on a phone and reopened on a wide kit as its exit finishes", async () => {
      await page.viewport(PHONE_WIDTH, VIEWPORT_HEIGHT);
      await render(<Harness kind="detail" />);
      const panel = await openSettled();

      await userEvent.keyboard("{Escape}");
      const exit = getExit(panel);
      exit.pause();
      await page.viewport(DESKTOP_WIDTH, VIEWPORT_HEIGHT);
      const reopened = reopenAsExitFinishes(panel);
      exit.play();
      await reopened;

      await expectSettledInsideKit(panel);
      await userEvent.click(overlay().getByRole("button", { name: "Close" }));
      await expect.element(overlay()).not.toBeInTheDocument();
    });
  });

  it("reverses from where the panel is when closed mid-enter", async () => {
    await render(<Harness />);
    await userEvent.click(opener());
    const panel = overlay().element();

    await userEvent.keyboard("{Escape}");

    const [first] = getFrames(getExit(panel));
    expect(Number(first.opacity)).toBeLessThan(1);
    const [scrimFirst] = getFrames(getExit(getScrim(panel)));
    expect(Number(scrimFirst.opacity)).toBeLessThan(1);
  });

  it("opens and closes instantly with reduced motion", async () => {
    await setReducedMotion(true);
    await render(<Harness />);
    await userEvent.click(opener());
    await expect.element(overlay()).toBeVisible();
    const panel = overlay().element();
    expect(panel.getAnimations()).toHaveLength(0);

    await userEvent.keyboard("{Escape}");

    expect(panel.isConnected).toBe(false);
  });

  it.each<OverlayKind>(["sheet", "detail"])(
    "slides a %s back out on a phone-width kit",
    async (kind) => {
      await page.viewport(PHONE_WIDTH, VIEWPORT_HEIGHT);
      await render(<Harness kind={kind} />);
      const panel = await openSettled();

      await userEvent.keyboard("{Escape}");

      const last = getFrames(getExit(panel)).at(-1);
      const offscreen =
        kind === "detail" ? "translateX(100%)" : "translateY(100%)";
      expect(last).toMatchObject({ transform: offscreen });
      expect(document.documentElement.scrollWidth).toBe(PHONE_WIDTH);
    },
  );

  it("keeps a detail's last content while it leaves after the caller clears it", async () => {
    await render(<ItemHarness />);
    await userEvent.click(page.getByRole("button", { name: "Open detail" }));
    const detail = page.getByRole("dialog", { name: ITEM.name });
    await expect.element(detail).toBeVisible();
    const panel = detail.element();

    await userEvent.keyboard("{Escape}");

    expect(panel.isConnected).toBe(true);
    expect(panel.getAttribute("aria-label")).toBe(ITEM.name);
    expect(panel.textContent).toContain(ITEM.name);
    expect(panel.textContent).toContain(ITEM.note);
  });

  it("keeps a confirm dialog's last copy while it leaves after the caller clears it", async () => {
    await render(<ItemHarness />);
    await userEvent.click(page.getByRole("button", { name: "Open decline" }));
    const dialog = page.getByRole("dialog", { name: `Decline ${ITEM.name}?` });
    await expect.element(dialog).toBeVisible();
    const panel = dialog.element();

    await userEvent.click(page.getByRole("button", { name: "Keep" }));

    expect(panel.isConnected).toBe(true);
    expect(panel.textContent).toContain(`Decline ${ITEM.name}?`);
    expect(panel.textContent).toContain(ITEM.note);
  });

  describe("toasts", () => {
    const toasts = () => page.getByRole("status");

    it("plays its exit when dismissed, inert, then unmounts", async () => {
      await render(<ToastHarness />);
      await userEvent.click(page.getByRole("button", { name: "Show toast" }));
      await expect.element(toasts()).toHaveTextContent("Toast 1");
      const card = toasts().element();

      await userEvent.click(page.getByRole("button", { name: "Dismiss" }));

      expect(card.isConnected).toBe(true);
      expect((card as HTMLElement).inert).toBe(true);
      expect(getFrames(getExit(card)).at(-1)).toMatchObject({
        opacity: "0",
        transform: "translateY(8px)",
      });
      await expect.poll(() => card.isConnected).toBe(false);
    });

    it("plays the exit of the oldest toast a fourth evicts, and counts only live ones", async () => {
      await render(<ToastHarness />);
      const show = page.getByRole("button", { name: "Show toast" });
      await userEvent.click(show);
      await userEvent.click(show);
      await userEvent.click(show);
      await expect.element(toasts().nth(2)).toHaveTextContent("Toast 3");
      const oldest = toasts().first().element();

      await userEvent.click(show);

      expect(oldest.isConnected).toBe(true);
      getExit(oldest);
      await expect.element(toasts().nth(2)).toHaveTextContent("Toast 4");
      expect(toasts().all()).toHaveLength(3);
      await userEvent.click(show);
      await expect.element(toasts().nth(2)).toHaveTextContent("Toast 5");
      expect(toasts().all()).toHaveLength(3);
    });
  });

  describe("pickers", () => {
    it("closes only the Combobox list on Escape inside a sheet", async () => {
      await render(<ComboboxInSheetHarness />);
      await userEvent.click(page.getByRole("combobox", { name: "Person" }));
      await expect
        .element(page.getByRole("listbox", { name: "Person" }))
        .toBeVisible();

      await userEvent.keyboard("{Escape}");

      await expect
        .element(page.getByRole("listbox", { name: "Person" }))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByRole("dialog", { name: "New booking" }))
        .toBeVisible();
    });

    it("enters the Combobox list at the kit-rise pace", async () => {
      await render(<PickerHarness />);
      await userEvent.click(page.getByRole("combobox", { name: "Person" }));
      const list = page.getByRole("listbox", { name: "Person" });
      await expect.element(list).toBeInTheDocument();

      const [enter] = list.element().getAnimations();
      expect(enter.effect?.getTiming().duration).toBe(KIT_RISE_MS);
    });

    it("drops the Select popover out, inert, then unmounts it", async () => {
      await render(<PickerHarness />);
      await userEvent.click(page.getByRole("combobox", { name: "Status" }));
      const list = page.getByRole("listbox", { name: "Status" });
      await expect.element(list).toBeVisible();
      const element = list.element() as HTMLElement;

      await userEvent.keyboard("{Escape}");

      expect(element.isConnected).toBe(true);
      expect(element.inert).toBe(true);
      expect(getFrames(getExit(element)).at(-1)).toMatchObject({
        transform: "translateY(8px)",
      });
      await expect
        .element(page.getByRole("combobox", { name: "Status" }))
        .toHaveAttribute("aria-expanded", "false");
      await expect.poll(() => element.isConnected).toBe(false);
    });

    it("drops the MultiSelectFilter popover out, inert, then unmounts it", async () => {
      await render(<PickerHarness />);
      await userEvent.click(page.getByRole("button", { name: "Kind" }));
      const popover = page.getByRole("dialog", { name: "Filter by Kind" });
      await expect.element(popover).toBeVisible();
      const element = popover.element() as HTMLElement;

      await userEvent.keyboard("{Escape}");

      expect(element.isConnected).toBe(true);
      expect(element.inert).toBe(true);
      getExit(element);
      await expect.poll(() => element.isConnected).toBe(false);
    });

    it("drops the Combobox list out without pointing assistive tech at it", async () => {
      await render(<PickerHarness />);
      const input = page.getByRole("combobox", { name: "Person" });
      await userEvent.click(input);
      const list = page.getByRole("listbox", { name: "Person" });
      await expect.element(list).toBeVisible();
      const element = list.element() as HTMLElement;

      await userEvent.keyboard("{Escape}");

      expect(element.isConnected).toBe(true);
      expect(element.inert).toBe(true);
      expect(element.id).toBe("");
      expect(input.element().getAttribute("aria-activedescendant")).toBeNull();
      getExit(element);
      await expect.poll(() => element.isConnected).toBe(false);
    });
  });
});
