import { useState } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/pages/prototype/shell-kit/kit/kit-root";
import { BottomSheet } from "@/pages/prototype/shell-kit/kit/overlays/bottom-sheet";
import { DetailOverlay } from "@/pages/prototype/shell-kit/kit/overlays/detail-overlay";
import { ConfirmDialog, Dialog } from "@/pages/prototype/shell-kit/kit/overlays/dialog";
import { useToast } from "@/pages/prototype/shell-kit/kit/overlays/use-toast";

const DESKTOP_WIDTH = 1280;
const DESKTOP_HEIGHT = 800;
const KIT_HEIGHT = "600px";
const START_SCROLL_TOP = 200;
const WHEEL_DELTA = 300;

type OverlayKind = "dialog" | "confirm" | "sheet" | "detail";

type OverlayProps = {
  kind: OverlayKind;
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
};

// One kit overlay of the given kind, titled "Overlay".
function Overlay({ kind, isOpen, onClose, children }: OverlayProps): ReactNode {
  if (kind === "dialog") {
    return (
      <Dialog isOpen={isOpen} onClose={onClose} title="Overlay" footer={null}>
        {children}
      </Dialog>
    );
  }
  if (kind === "confirm") {
    return (
      <ConfirmDialog
        isOpen={isOpen}
        onClose={onClose}
        onConfirm={onClose}
        title="Overlay"
        confirmLabel="Confirm"
        keepLabel="Keep"
      >
        {children}
      </ConfirmDialog>
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

type HarnessProps = { kind?: OverlayKind; isInitiallyOpen?: boolean };

function Harness({
  kind = "detail",
  isInitiallyOpen = false,
}: HarnessProps): ReactNode {
  const [isOpen, setIsOpen] = useState(isInitiallyOpen);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  return (
    <KitRoot theme="light" height={KIT_HEIGHT}>
      {/* The opener sits low enough to stay in view with the page scrolled. */}
      <div className="h-[2000px] pt-[400px]">
        <button type="button" onClick={() => setIsOpen(true)}>
          Open overlay
        </button>
      </div>
      <Overlay kind={kind} isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <button type="button" onClick={() => setIsConfirmOpen(true)}>
          Open confirm
        </button>
        <SaveButton />
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

const undoSpy = vi.fn();

function SaveButton(): ReactNode {
  const { showToast } = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        showToast({
          tone: "success",
          message: "Saved the overlay.",
          actionLabel: "Undo",
          onAction: undoSpy,
        })
      }
    >
      Save
    </button>
  );
}

const opener = () => page.getByRole("button", { name: "Open overlay" });
const overlay = () => page.getByRole("dialog", { name: "Overlay" });
const confirmOpener = () => page.getByRole("button", { name: "Open confirm" });
const confirm = () => page.getByRole("dialog", { name: "Sure?" });

function getScrollArea(): HTMLElement {
  const area = document.querySelector<HTMLElement>("[data-kit-scroll]");
  if (!area) throw new Error("KitRoot rendered no scroll area");
  return area;
}

// A point on the page side of every overlay: the scrim, where a wheel
// over the page lands.
const PAGE_SIDE_POINT = { x: 20, y: 300 };

function getElementOverPage(): Element {
  const element = document.elementFromPoint(PAGE_SIDE_POINT.x, PAGE_SIDE_POINT.y);
  if (!element) throw new Error("Nothing under the page-side point");
  return element;
}

function getButtonByText(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (element) => element.textContent === text,
  );
  if (!button) throw new Error(`No button reading "${text}"`);
  return button;
}

describe("kit overlays", () => {
  beforeEach(async () => {
    await page.viewport(DESKTOP_WIDTH, DESKTOP_HEIGHT);
    undoSpy.mockClear();
  });

  it.each<OverlayKind>(["dialog", "confirm", "sheet", "detail"])(
    "leaves the page behind an open %s unreachable",
    async (kind) => {
      await render(<Harness kind={kind} isInitiallyOpen />);
      await expect.element(overlay()).toBeVisible();

      await expect.element(opener()).not.toBeInTheDocument();
      const pageButton = getButtonByText("Open overlay");
      pageButton.focus();
      expect(document.activeElement).not.toBe(pageButton);
    },
  );

  it("closes on Escape and returns focus to the opener", async () => {
    await render(<Harness />);
    await userEvent.click(opener());
    await expect.element(overlay()).toBeVisible();

    await userEvent.keyboard("{Escape}");

    await expect.element(overlay()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  it("keeps only the top overlay live when two are stacked", async () => {
    await render(<Harness />);
    await userEvent.click(opener());
    await userEvent.click(confirmOpener());
    await expect.element(confirm()).toBeVisible();

    await expect.element(confirmOpener()).not.toBeInTheDocument();
    await expect.element(opener()).not.toBeInTheDocument();
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.tab();
    expect(confirm().element().contains(document.activeElement)).toBe(true);

    await userEvent.keyboard("{Escape}");

    await expect.element(confirm()).not.toBeInTheDocument();
    await expect.element(overlay()).toBeVisible();
    await expect.element(confirmOpener()).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    await expect.element(overlay()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  it("keeps a toast readable and its button usable while an overlay is open", async () => {
    await render(<Harness />);
    await userEvent.click(opener());
    await userEvent.click(page.getByRole("button", { name: "Save" }));

    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Saved the overlay.");
    await userEvent.click(page.getByRole("button", { name: "Undo" }));

    expect(undoSpy).toHaveBeenCalledOnce();
    await expect.element(overlay()).toBeVisible();
  });

  it("locks the page scroll while an overlay is open, then unlocks it in place", async () => {
    await render(<Harness />);
    const scrollArea = getScrollArea();
    scrollArea.scrollTop = START_SCROLL_TOP;
    await userEvent.click(opener());
    await expect.element(overlay()).toBeVisible();

    await userEvent.wheel(getElementOverPage(), { delta: { y: WHEEL_DELTA } });
    await new Promise(requestAnimationFrame);
    expect(scrollArea.scrollTop).toBe(START_SCROLL_TOP);

    await userEvent.keyboard("{Escape}");
    await expect.element(overlay()).not.toBeInTheDocument();
    expect(scrollArea.scrollTop).toBe(START_SCROLL_TOP);

    await userEvent.wheel(scrollArea, { delta: { y: WHEEL_DELTA } });
    await expect
      .poll(() => scrollArea.scrollTop)
      .toBeGreaterThan(START_SCROLL_TOP);
  });
});
