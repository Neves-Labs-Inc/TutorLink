import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import AppLayout from "@/components/layout/app-layout";
import { useAuthStore } from "@/stores/authStore";
import KitRoot from "@/components/kit/kit-root";
import FamiliesPage from "@/pages/families/families-page";
import { renderWithProviders } from "@/test/render-with-providers";
import type { HouseholdRead } from "@/types/families";

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));

const LAURA: HouseholdRead = {
  key: "g-1",
  name: "Laura & Diego Souza",
  archived: false,
  guardians: [
    { id: "g-1", name: "Laura Souza", phone_number: "+15550001", archived: false },
    { id: "g-2", name: "Diego Souza", phone_number: "+15550002", archived: false },
  ],
  children: [
    { id: "c-1", name: "Sofia Souza", grade_level: 5, archived: false },
    { id: "c-2", name: "Mateo Souza", grade_level: 2, archived: false },
    { id: "c-3", name: "Tomás Souza", grade_level: 2, archived: true },
  ],
  homes: [
    { id: "h-1", label: null, address: "1 Palm St", directions: null, archived: false, guardian_ids: ["g-1"] },
    { id: "h-2", label: null, address: "2 Old St", directions: null, archived: true, guardian_ids: ["g-1"] },
  ],
  next_booking: {
    id: "b-1",
    kind: "regular",
    scheduled_date: "2026-10-15",
    start_time: "15:30:00",
    end_time: "16:30:00",
    location: "home",
    child: { id: "c-1", name: "Sofia Souza" },
    staff: { id: "s-1", name: "Ana Tutor" },
  },
};

const RIVERA: HouseholdRead = {
  key: "g-3",
  name: "Rivera family",
  archived: true,
  guardians: [{ id: "g-3", name: "Monica Rivera", phone_number: "+15550003", archived: true }],
  children: [],
  homes: [],
  next_booking: null,
};

const pageOf = (items: HouseholdRead[], total = items.length, pageNumber = 1) => ({
  items,
  total,
  page: pageNumber,
  page_size: 50,
});

const ok = (data: unknown) => Promise.resolve({ data });

function lastParams(): Record<string, unknown> {
  const calls = network.get.mock.calls;
  return calls[calls.length - 1][1].params;
}

function Where(): ReactNode {
  const location = useLocation();
  return <output aria-label="Location">{location.pathname}</output>;
}

function renderList() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/families"]}>
      <KitRoot theme="light" height="640px">
        <Routes>
          <Route path="/families" element={<FamiliesPage />} />
          <Route path="/families/:memberId" element={<Where />} />
        </Routes>
      </KitRoot>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.get.mockImplementation(() => ok(pageOf([LAURA, RIVERA], 2)));
});

describe("families list", () => {
  it("shows Family, Children, Homes and Next booking for each family", async () => {
    await renderList();
    await expect.element(page.getByRole("heading", { level: 1, name: "Families" })).toBeVisible();
    await expect.element(page.getByText("2 families")).toBeVisible();

    const table = page.getByRole("table", { name: "Families" });
    await expect.element(table.getByText("Laura & Diego Souza")).toBeVisible();
    await expect.element(table.getByText("Laura Souza, Diego Souza")).toBeVisible();
    // Archived Children stay out.
    await expect.element(table.getByText("Sofia, Mateo", { exact: true })).toBeVisible();
    await expect.element(table.getByText("Thu, Oct 15, 3:30 PM")).toBeVisible();
    await expect.element(table.getByText("No Children yet")).toBeVisible();
    await expect.element(table.getByText("Homes")).toBeVisible();
  });

  it("marks an archived family with the Archived badge instead of a booking", async () => {
    await renderList();
    const row = page.getByRole("row", { name: /Rivera family/ });
    await expect.element(row.getByText("Archived")).toBeVisible();
    await expect.element(row.getByText("Nothing booked")).not.toBeInTheDocument();
  });

  it("says Nothing booked for a family without a booking", async () => {
    network.get.mockImplementation(() => ok(pageOf([{ ...LAURA, next_booking: null }])));
    await renderList();
    await expect.element(page.getByText("Nothing booked", { exact: true })).toBeVisible();
  });

  it("disables both Add buttons until their tickets land", async () => {
    await renderList();
    await expect.element(page.getByRole("button", { name: "Add guardian" })).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Add child" })).toBeDisabled();
  });

  it("shows phone rows at 390px", async () => {
    await page.viewport(390, 800);
    await renderList();
    const list = page.getByRole("list", { name: "Families" });
    await expect.element(list.getByText("Children: Sofia, Mateo")).toBeVisible();
    await expect
      .element(list.getByText("2 Guardians · 1 Home · Next: Thu, Oct 15, 3:30 PM"))
      .toBeVisible();
    await expect.element(list.getByText("1 Guardian · 0 Homes · Next: Nothing booked")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Add child" })).toBeVisible();
  });

  it("opens the family when its row is pressed", async () => {
    await renderList();
    await page.getByRole("button", { name: "Open Laura & Diego Souza" }).click();
    await expect.element(page.getByRole("status", { name: "Location" }).first()).toHaveTextContent("/families/g-1");
  });

  it("searches after a pause and starts again from page 1", async () => {
    network.get.mockImplementation(() => ok(pageOf([LAURA], 120)));
    await renderList();
    await page.getByRole("button", { name: "Page 2" }).click();
    await expect.poll(() => lastParams().page).toBe(2);

    await userEvent.fill(page.getByRole("searchbox", { name: "Search families" }), "sofia");
    await expect.poll(() => lastParams()).toMatchObject({ q: "sofia", page: 1 });
  });

  it("sends include_archived when Show archived is on", async () => {
    await renderList();
    expect(lastParams().include_archived).toBeUndefined();
    await page.getByRole("button", { name: "Show archived" }).click();
    await expect.poll(() => lastParams().include_archived).toBe(true);
  });

  it("shows page numbers past 50 families and requests the chosen page", async () => {
    network.get.mockImplementation(() => ok(pageOf([LAURA], 120)));
    await renderList();
    const pager = page.getByRole("navigation", { name: "Families pages" });
    await expect.element(pager).toBeVisible();
    await page.getByRole("button", { name: "Page 3" }).click();
    await expect.poll(() => lastParams().page).toBe(3);
  });

  it("hides the pager at 50 families or fewer", async () => {
    await renderList();
    await expect.element(page.getByText("Laura & Diego Souza").first()).toBeVisible();
    expect(page.getByRole("navigation", { name: "Families pages" }).elements()).toHaveLength(0);
  });

  it("shows a loading skeleton and no description while the first page loads", async () => {
    network.get.mockImplementation(() => new Promise(() => {}));
    await renderList();
    await expect.element(page.getByRole("status", { name: "Loading families" })).toBeVisible();
    expect(page.getByText(/\d+ famil(y|ies)/).elements()).toHaveLength(0);
  });

  it("offers Try again when the list fails to load", async () => {
    network.get.mockImplementationOnce(() => Promise.reject(new Error("offline")));
    await renderList();
    await expect.element(page.getByText("Couldn’t load families")).toBeVisible();
    await expect.element(page.getByText("Check your connection and try again.")).toBeVisible();
    await expect.element(page.getByRole("heading", { level: 1, name: "Families" })).toBeVisible();

    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(page.getByText("Laura & Diego Souza").first()).toBeVisible();
  });

  it("says No families yet, with no action", async () => {
    network.get.mockImplementation(() => ok(pageOf([])));
    await renderList();
    await expect.element(page.getByRole("heading", { name: "No families yet" })).toBeVisible();
    await expect
      .element(page.getByText("They appear here once the bot or the office adds a Guardian."))
      .toBeVisible();
    expect(page.getByRole("button", { name: "Try again" }).elements()).toHaveLength(0);
  });

  it("says No families match when a search finds nothing", async () => {
    await renderList();
    await expect.element(page.getByText("Laura & Diego Souza").first()).toBeVisible();
    network.get.mockImplementation(() => ok(pageOf([])));
    await userEvent.fill(page.getByRole("searchbox", { name: "Search families" }), "zzz");
    await expect.element(page.getByRole("heading", { name: "No families match" })).toBeVisible();
    await expect
      .element(page.getByText("Try a Child’s or Guardian’s name, or a phone number."))
      .toBeVisible();
  });

  it("shows the Homes column at 1280px inside the app shell", async () => {
    useAuthStore.setState({ status: "authenticated", role: "admin" });
    network.get.mockImplementation((url: string) => {
      if (url === "/api/households") return ok(pageOf([LAURA]));
      return ok(url === "/api/me" ? { id: "u-1", email: "a@b.c", role: "admin", name: "Rita" } : {});
    });
    await renderWithProviders(
      <MemoryRouter initialEntries={["/families"]}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/families" element={<FamiliesPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await expect.element(page.getByRole("columnheader", { name: "Homes" })).toBeVisible();
  });

  it("shows the loading skeleton, not the empty copy, while a new query loads after an empty one", async () => {
    network.get.mockImplementation(() => ok(pageOf([])));
    await renderList();
    await expect.element(page.getByRole("heading", { name: "No families yet" })).toBeVisible();

    network.get.mockImplementation(() => new Promise(() => {}));
    await page.getByRole("button", { name: "Show archived" }).click();
    await expect.element(page.getByRole("status", { name: "Loading families" })).toBeVisible();
    expect(page.getByRole("heading", { name: "No families yet" }).elements()).toHaveLength(0);
  });
});
