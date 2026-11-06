// An account sheet belongs to the member it was opened for: browser Back
// (the phone back gesture) must not leave it over the list, where it would
// swallow every tap on other rows and the nav.
import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import {
  ANA,
  DAN,
  MO,
  RITA,
  getPath,
  makeStaff,
  renderApp,
  respond,
} from "@/tests/pages/staff/staff-harness";

const network = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

// Any live member the Admin can act on. A new one (no Subjects) also offers
// the checklist's "Add subjects".
const SARAH = makeStaff({ id: "u-sarah", name: "Sarah Kim", tutor_id: "t-sarah", email: "sarah@example.com", subjects: [], sign_in_state: "not_invited" });
const START_URL = window.location.href;

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  respond(network.get, { staff: [ANA, RITA, DAN, MO, SARAH] });
  const base = network.get.getMockImplementation()!;
  network.get.mockImplementation(async (url: string, config?: unknown) => {
    if (url.startsWith("/api/staff") || url === "/api/me" || url === "/api/counts") return base(url, config);
    return { data: { items: [], total: 0, page: 1, page_size: 25 } };
  });
});
afterAll(() => window.history.replaceState(null, "", START_URL));

async function openSarah(): Promise<void> {
  window.history.pushState(null, "", "/staff");
  await renderApp("/staff");
  await page.getByRole("button", { name: "Open Sarah Kim" }).click();
  await expect
    .element(page.getByRole("dialog", { name: "Staff: Sarah Kim" }))
    .toBeVisible();
}

async function goBackToList(): Promise<void> {
  window.history.back();
  await expect.poll(getPath).toBe("/staff");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
}

async function expectRowsReachable(): Promise<void> {
  await page.getByRole("button", { name: "Open Ana Brooks" }).click();
  await expect
    .element(page.getByRole("dialog", { name: "Staff: Ana Brooks" }))
    .toBeVisible();
}

describe("Staff account sheets and browser Back", () => {
  it.each([
    ["Edit", "Edit Sarah Kim"],
    ["More actions", "Send invite"],
    ["Add subjects", "Subjects"],
  ])("%s, then Back: nothing of Sarah's stays over the list", async (button, sheetText) => {
    await openSarah();
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect
      .element(page.getByRole("dialog").getByText(sheetText).first())
      .toBeVisible();

    await goBackToList();
    await expectRowsReachable();
  });

  it("the archive confirm closes on Back too", async () => {
    await openSarah();
    await page.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("button", { name: /^Archive/ }).click();
    await expect.element(page.getByRole("alertdialog")).toBeVisible();

    await goBackToList();
    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    await expectRowsReachable();
  });

  it("reopening the same member after Back shows no sheet", async () => {
    await openSarah();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect
      .element(page.getByRole("dialog").getByText("Edit Sarah Kim").first())
      .toBeVisible();
    await goBackToList();

    await page.getByRole("button", { name: "Open Sarah Kim" }).click();
    await expect
      .element(page.getByRole("dialog", { name: "Staff: Sarah Kim" }))
      .toBeVisible();
    await expect
      .poll(() => page.getByRole("dialog").elements().length)
      .toBe(1);
  });

  it("Back from one member's details to another's closes the first's sheet", async () => {
    window.history.pushState(null, "", "/staff");
    await renderApp("/staff");
    await page.getByRole("button", { name: "Open Ana Brooks" }).click();
    await expect
      .element(page.getByRole("dialog", { name: "Staff: Ana Brooks" }))
      .toBeVisible();
    // The open panel covers the rows, so push Sarah's entry the way the router does and tell it.
    const { idx } = window.history.state as { idx: number };
    window.history.pushState(
      { usr: null, key: "sarah-entry", idx: idx + 1 },
      "",
      "/staff/u-sarah",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(getPath).toBe("/staff/u-sarah");
    await expect
      .element(page.getByRole("dialog", { name: "Staff: Sarah Kim" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect
      .element(page.getByRole("dialog").getByText("Edit Sarah Kim").first())
      .toBeVisible();

    window.history.back();
    await expect.poll(getPath).toBe("/staff/u-ana");
    await expect
      .element(page.getByRole("dialog", { name: "Staff: Ana Brooks" }))
      .toBeVisible();
    await expect
      .poll(() => page.getByRole("dialog").elements().length)
      .toBe(1);
  });
});
