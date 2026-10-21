import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import TimeGrid from "@/components/kit/components/time-grid";
import type { GridColumn } from "@/components/kit/components/time-grid";

function makeColumn(id: string, overrides: Partial<GridColumn> = {}): GridColumn {
  return {
    id,
    header: <span>{id}</span>,
    blocks: [],
    createLabel: (time) => `New booking ${id} at ${time}`,
    ...overrides,
  };
}

const MONDAY = makeColumn("Mon", {
  blocks: [
    {
      id: "booking-1",
      startTime: "15:30:00",
      endTime: "16:30:00",
      time: "3:30 PM",
      name: "Emma Souza",
      what: "Math",
      staffName: "Ana Souza",
      status: "confirmed",
      tone: "primary",
    },
  ],
});
const TUESDAY = makeColumn("Tue");

function renderGrid(columns: GridColumn[], onOpen = vi.fn(), onCreateAt = vi.fn()) {
  return render(
    <KitRoot theme="light">
      <div className="p-4">
        <TimeGrid columns={columns} onOpen={onOpen} onCreateAt={onCreateAt} />
      </div>
    </KitRoot>,
  );
}

describe("TimeGrid", () => {
  it("renders each column's blocks in that column", async () => {
    await renderGrid([MONDAY, TUESDAY]);

    await expect
      .element(page.getByRole("button", { name: /Emma Souza/ }))
      .toBeVisible();
    expect(page.getByRole("button", { name: /Emma Souza/ }).elements()).toHaveLength(1);
  });

  it("calls back with the column and time when an empty hour is clicked", async () => {
    const onCreateAt = vi.fn();
    await renderGrid([MONDAY, TUESDAY], vi.fn(), onCreateAt);

    await page
      .getByRole("button", { name: "New booking Tue at 10:00:00" })
      .click({ force: true });

    expect(onCreateAt).toHaveBeenCalledWith("Tue", "10:00:00");
  });

  it("calls back with the block's id when a block is clicked", async () => {
    const onOpen = vi.fn();
    await renderGrid([MONDAY, TUESDAY], onOpen);

    await page.getByRole("button", { name: /Emma Souza/ }).click();

    expect(onOpen).toHaveBeenCalledWith("booking-1");
  });

  it("widens the hours to cover an early and a late Booking", async () => {
    const early = makeColumn("Wed", {
      blocks: [
        { ...MONDAY.blocks[0], id: "early", startTime: "06:00:00", endTime: "07:00:00" },
        { ...MONDAY.blocks[0], id: "late", startTime: "21:00:00", endTime: "22:00:00" },
      ],
    });
    await renderGrid([early]);

    await expect
      .element(page.getByRole("button", { name: "New booking Wed at 06:00:00" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "New booking Wed at 21:00:00" }))
      .toBeInTheDocument();
  });

  it("shows Time off chips under the header", async () => {
    await renderGrid([
      makeColumn("Mon", {
        timeOff: [{ id: "t1", label: "Ana off", title: "Ana Souza is off" }],
      }),
    ]);

    await expect.element(page.getByText("Ana off")).toBeVisible();
    await expect.element(page.getByText("Off", { exact: true })).toBeVisible();
  });

  it("fits seven week columns in a 768px container without sideways scroll", async () => {
    const week = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((id) =>
      makeColumn(id),
    );
    await render(
      <KitRoot theme="light">
        <div style={{ width: 768 }} data-testid="frame">
          <TimeGrid columns={week} onOpen={vi.fn()} onCreateAt={vi.fn()} />
        </div>
      </KitRoot>,
    );

    const card = page.getByTestId("frame").element().firstElementChild as HTMLElement;
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
  });

  it("scrolls Day-by-Staff columns inside the card", async () => {
    const staff = Array.from({ length: 8 }, (_, index) => makeColumn(`S${index}`));
    await render(
      <KitRoot theme="light">
        <div style={{ width: 768 }} data-testid="frame">
          <TimeGrid columns={staff} minColumnPx={140} onOpen={vi.fn()} onCreateAt={vi.fn()} />
        </div>
      </KitRoot>,
    );

    const card = page.getByTestId("frame").element().firstElementChild as HTMLElement;
    expect(card.scrollWidth).toBeGreaterThan(card.clientWidth);
  });

  it("widens the hours to cover availability past 8 PM", async () => {
    await renderGrid([
      makeColumn("Thu", { availability: [{ start: "15:00:00", end: "21:00:00" }] }),
    ]);

    await expect
      .element(page.getByRole("button", { name: "New booking Thu at 20:00:00" }))
      .toBeInTheDocument();
  });

  it("draws the now line and its dot only on the first column that has it", async () => {
    await render(
      <KitRoot theme="light">
        <TimeGrid
          columns={[
            makeColumn("A", { hasNow: true }),
            makeColumn("B", { hasNow: true }),
          ]}
          nowTime="10:30:00"
          onOpen={vi.fn()}
          onCreateAt={vi.fn()}
        />
      </KitRoot>,
    );

    const lines = document.querySelectorAll(".bg-\\(--tl-danger\\)");
    expect(lines).toHaveLength(3);
  });

  it("leaves the now line out when the time is outside the hour range", async () => {
    await render(
      <KitRoot theme="light">
        <TimeGrid
          columns={[makeColumn("A", { hasNow: true })]}
          nowTime="06:15:00"
          onOpen={vi.fn()}
          onCreateAt={vi.fn()}
        />
      </KitRoot>,
    );

    expect(document.querySelectorAll(".bg-\\(--tl-danger\\)")).toHaveLength(0);
  });

  it("keeps the name visible in two overlapping one-hour blocks at 768px", async () => {
    const base = MONDAY.blocks[0];
    const overlapping = makeColumn("Mon", {
      blocks: [
        { ...base, id: "a", name: "Emma", fullName: "Emma Souza", startTime: "16:00:00", endTime: "17:00:00", time: "4:00 PM" },
        { ...base, id: "b", name: "Liam", fullName: "Liam Souza", startTime: "16:00:00", endTime: "17:00:00", time: "4:00 PM" },
      ],
    });
    const columns = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((id) =>
      id === "Mon" ? overlapping : makeColumn(id),
    );
    await render(
      <KitRoot theme="light">
        <div style={{ width: 768 }}>
          <TimeGrid columns={columns} onOpen={vi.fn()} onCreateAt={vi.fn()} />
        </div>
      </KitRoot>,
    );

    for (const name of [/Emma Souza/, /Liam Souza/]) {
      const block = page.getByRole("button", { name }).element() as HTMLElement;
      expect(block.scrollHeight).toBeLessThanOrEqual(block.clientHeight);
    }
    await expect.element(page.getByText("Emma", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Liam", { exact: true })).toBeVisible();
  });
});
