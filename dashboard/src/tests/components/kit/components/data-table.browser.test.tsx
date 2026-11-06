import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { DataTable } from "@/components/kit/components/data-table";

type Person = { id: string; name: string; role: string };

const PEOPLE: Person[] = [
  { id: "1", name: "Ana", role: "Tutor" },
  { id: "2", name: "Bruno", role: "Manager" },
];

const onOpenRow = vi.fn();
const onInnerClick = vi.fn();

async function renderTable(options: { busyId?: string } = {}) {
  await render(
    <KitRoot theme="light">
      <button type="button">Outside</button>
      <DataTable
        caption="People"
        rows={PEOPLE}
        columns={[
          { id: "name", header: "Name", render: (row) => row.name },
          { id: "role", header: "Role", render: (row) => row.role },
          {
            id: "action",
            header: "Action",
            render: (row) => (
              <button type="button" onClick={onInnerClick}>
                Inner {row.name}
              </button>
            ),
          },
        ]}
        getRowId={(row) => row.id}
        getRowTitle={(row) => row.name}
        getPhoneRow={(row) => ({ title: row.name })}
        onOpenRow={onOpenRow}
        isRowBusy={(row) => row.id === options.busyId}
      />
    </KitRoot>,
  );
}

const getRows = () => [...document.querySelectorAll("tbody tr")];

beforeEach(async () => {
  onOpenRow.mockClear();
  onInnerClick.mockClear();
  await page.viewport(1280, 800);
});

describe("kit DataTable desktop rows", () => {
  it("opens the row once when any cell is clicked", async () => {
    await renderTable();
    const [row] = getRows();
    const cells = [...row.querySelectorAll("td")];

    for (const cell of [cells[0], cells[1], cells[cells.length - 1]]) {
      onOpenRow.mockClear();
      cell.click();
      expect(onOpenRow).toHaveBeenCalledTimes(1);
      expect(onOpenRow).toHaveBeenCalledWith(PEOPLE[0]);
    }
  });

  it("does not open a row when something outside the table is clicked", async () => {
    await renderTable();

    await page.getByRole("button", { name: "Outside" }).click();

    expect(onOpenRow).not.toHaveBeenCalled();
  });

  it("keeps every open button inside its own row with nothing positioned absolutely", async () => {
    await renderTable();

    for (const [index, row] of getRows().entries()) {
      const rowBox = row.getBoundingClientRect();
      const button = page
        .getByRole("button", { name: `Open ${PEOPLE[index].name}` })
        .element();
      const box = button.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(rowBox.top);
      expect(box.bottom).toBeLessThanOrEqual(rowBox.bottom);
      expect(box.left).toBeGreaterThanOrEqual(rowBox.left);
      expect(box.right).toBeLessThanOrEqual(rowBox.right);

      for (const element of row.querySelectorAll("*")) {
        expect(["absolute", "fixed"]).not.toContain(
          getComputedStyle(element).position,
        );
      }
    }
  });

  it("gives one tab stop per row that opens it on Enter and on Space", async () => {
    await renderTable();

    await userEvent.tab();
    expect(page.getByRole("button", { name: "Outside" }).element()).toBe(
      document.activeElement,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(
      page.getByRole("button", { name: "Open Ana" }).element(),
    );

    await userEvent.keyboard("{Enter}");
    expect(onOpenRow).toHaveBeenCalledTimes(1);
    expect(onOpenRow).toHaveBeenLastCalledWith(PEOPLE[0]);

    await userEvent.keyboard(" ");
    expect(onOpenRow).toHaveBeenCalledTimes(2);

    await userEvent.tab();
    expect(document.activeElement).toBe(
      page.getByRole("button", { name: "Inner Ana" }).element(),
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(
      page.getByRole("button", { name: "Open Bruno" }).element(),
    );
  });

  it("marks only the busy row's open button as busy", async () => {
    await renderTable({ busyId: "2" });

    await expect
      .element(page.getByRole("button", { name: "Open Bruno" }))
      .toHaveAttribute("aria-busy", "true");
    await expect
      .element(page.getByRole("button", { name: "Open Ana" }))
      .not.toHaveAttribute("aria-busy");
  });

  it("runs a column button's own handler without opening the row", async () => {
    await renderTable();

    await page.getByRole("button", { name: "Inner Ana" }).click();

    expect(onInnerClick).toHaveBeenCalledTimes(1);
    expect(onOpenRow).not.toHaveBeenCalled();
  });

  it("draws the keyboard focus ring round the whole row, not the button", async () => {
    await renderTable();

    await userEvent.tab();
    await userEvent.tab();

    const [row] = getRows();
    const rowStyle = getComputedStyle(row);
    expect(rowStyle.outlineStyle).toBe("solid");
    expect(rowStyle.outlineWidth).toBe("2px");
    expect(rowStyle.outlineOffset).toBe("-2px");
    const button = page.getByRole("button", { name: "Open Ana" }).element();
    expect(getComputedStyle(button).outlineStyle).toBe("none");
  });
});
