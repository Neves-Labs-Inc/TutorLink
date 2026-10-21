import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import FamiliesPage from "@/pages/families/families-page";
import { renderWithProviders } from "@/test/render-with-providers";
import type { HouseholdRead } from "@/types/families";

const network = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: network,
}));

const LAURA_FAMILY: HouseholdRead = {
  key: "g-1",
  name: "Laura & Diego Souza",
  archived: false,
  guardians: [
    { id: "g-1", name: "Laura Souza", phone_number: "+13055550100", archived: false },
    { id: "g-2", name: "Diego Souza", phone_number: "+13055550101", archived: false },
    { id: "g-4", name: "Carla Souza", phone_number: "+13055550104", archived: true },
  ],
  children: [],
  homes: [],
  next_booking: null,
};

const SOLO_FAMILY: HouseholdRead = {
  ...LAURA_FAMILY,
  key: "g-3",
  guardians: [{ id: "g-3", name: "Monica Rivera", phone_number: "+13055550103", archived: false }],
};

function summary(id: string, name: string, phone: string) {
  return {
    id,
    name,
    phone_number: phone,
    archived: false,
    home_count: 0,
    child_count: 0,
    language: "en",
    reminders: "opt_in",
    reminders_blocked_by_whatsapp: false,
    children: [],
  };
}

const GUARDIANS = [
  summary("g-1", "Laura Souza", "+13055550100"),
  summary("g-3", "Monica Rivera", "+13055550103"),
];

function httpError(status: number, data: unknown = {}): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(String(status), "ERR_BAD_REQUEST", config, null, {
    status,
    statusText: String(status),
    headers: {},
    config,
    data,
  });
}

type Responses = Record<string, () => Promise<unknown>>;
const ok = (data: unknown) => () => Promise.resolve({ data });
const empty = { items: [], total: 0, page: 1, page_size: 50 };

function serve(extra: Responses = {}): void {
  const responses: Responses = {
    "/api/households": ok({ ...empty, items: [LAURA_FAMILY], total: 1 }),
    "/api/clients": ok({ items: GUARDIANS, total: 2, page: 1, page_size: 100 }),
    "/api/households/g-1": ok(LAURA_FAMILY),
    "/api/households/g-3": ok(SOLO_FAMILY),
    "/api/households/g-9": ok({
      ...SOLO_FAMILY,
      key: "g-9",
      guardians: [{ id: "g-9", name: "Ana Lima", phone_number: "+13055550199", archived: false }],
    }),
    ...extra,
  };
  network.get.mockImplementation((url: string) => {
    const respond = responses[url];
    return respond ? respond() : Promise.reject(httpError(404));
  });
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
    </MemoryRouter>,
  );
}

const guardianSheet = () => page.getByRole("dialog", { name: "Add guardian" });
const childSheet = () => page.getByRole("dialog", { name: "Add child" });

async function openChildSheet() {
  await renderList();
  await page.getByRole("button", { name: "Add child" }).first().click();
  return childSheet();
}

async function fillChild(add: ReturnType<typeof childSheet>, name = "Luca Souza") {
  await add.getByRole("textbox", { name: "Name" }).first().fill(name);
  await add.getByLabelText("Date of birth").fill("2018-03-04");
}

async function pickGuardian(add: ReturnType<typeof childSheet>, name: string) {
  await add.getByRole("button", { name: "Existing guardian" }).click();
  await userEvent.click(add.getByRole("combobox", { name: "Guardian" }));
  await userEvent.click(page.getByRole("option", { name: new RegExp(name) }));
}

const CHILD_BODY = {
  name: "Luca Souza",
  date_of_birth: "2018-03-04",
  grade_level: null,
  school_name: "",
  notes: null,
};

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.post.mockReset();
  serve();
});

describe("Add guardian from the list", () => {
  it("creates a new family with a Home and opens it", async () => {
    network.post.mockResolvedValue({ data: { id: "g-9", name: "Ana Lima" } });
    await renderList();
    await page.getByRole("button", { name: "Add guardian" }).first().click();
    const add = guardianSheet();
    await expect.element(add.getByText("Directions for Staff")).not.toBeInTheDocument();
    await add.getByRole("textbox", { name: "Name" }).fill("Ana Lima");
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("+1 305 555 0199");
    await add.getByRole("textbox", { name: "Home address" }).fill("1 Palm St");
    await add.getByRole("textbox", { name: "Directions for Staff" }).fill("Gate code 12");
    await add.getByRole("button", { name: "Add guardian" }).click();

    expect(network.post).toHaveBeenCalledWith("/api/clients", {
      name: "Ana Lima",
      phone_number: "+1 305 555 0199",
      home: { label: null, address: "1 Palm St", directions: "Gate code 12" },
    });
    await expect.element(page.getByText("Ana Lima added as a new family.")).toBeVisible();
    await expect.element(page.getByLabelText("Location")).toHaveTextContent("/families/g-9");
  });

  it("sends no Home when the address is blank", async () => {
    network.post.mockResolvedValue({ data: { id: "g-9", name: "Ana Lima" } });
    await renderList();
    await page.getByRole("button", { name: "Add guardian" }).first().click();
    const add = guardianSheet();
    await add.getByRole("textbox", { name: "Name" }).fill("Ana Lima");
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("+1 305 555 0199");
    await add.getByRole("button", { name: "Add guardian" }).click();
    expect(network.post).toHaveBeenCalledWith("/api/clients", {
      name: "Ana Lima",
      phone_number: "+1 305 555 0199",
      home: null,
    });
  });

  it("opens as a bottom sheet from the phone buttons", async () => {
    await page.viewport(375, 800);
    await renderList();
    await page.getByRole("button", { name: "Add guardian" }).first().click();
    await expect.element(guardianSheet()).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});

describe("Add child from the list", () => {
  it("checks the Child and a new Guardian on submit, then on blur", async () => {
    const add = await openChildSheet();
    await add.getByRole("button", { name: "Add child" }).click();
    await expect.element(add.getByText("Enter the Child’s name.")).toBeVisible();
    await expect.element(add.getByText("Enter the Guardian’s name.")).toBeVisible();
    await expect
      .element(add.getByText("Enter a WhatsApp number with country code."))
      .toBeVisible();
    expect(network.post).not.toHaveBeenCalled();

    await add.getByRole("textbox", { name: "Name" }).nth(1).fill("Ana Lima");
    await add.getByRole("textbox", { name: "School" }).click();
    await expect.element(add.getByText("Enter the Guardian’s name.")).not.toBeInTheDocument();
  });

  it("asks to pick a Guardian on the Existing side", async () => {
    const add = await openChildSheet();
    await fillChild(add);
    await add.getByRole("button", { name: "Existing guardian" }).click();
    await add.getByRole("button", { name: "Add child" }).click();
    await expect.element(add.getByText("Pick a Guardian.")).toBeVisible();
    expect(network.post).not.toHaveBeenCalled();
  });

  it("creates the Guardian, then the Child, and opens the family", async () => {
    network.post
      .mockResolvedValueOnce({ data: { id: "g-9", name: "Ana Lima" } })
      .mockResolvedValueOnce({ data: { id: "c-9", name: "Luca Souza" } });
    const add = await openChildSheet();
    await fillChild(add);
    await add.getByRole("textbox", { name: "Name" }).nth(1).fill("Ana Lima");
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("+1 305 555 0199");
    await add.getByRole("button", { name: "Add child" }).click();

    await expect.element(page.getByText("Luca Souza added.")).toBeVisible();
    expect(network.post.mock.calls).toEqual([
      ["/api/clients", { name: "Ana Lima", phone_number: "+1 305 555 0199" }],
      ["/api/children", { ...CHILD_BODY, guardian_ids: ["g-9"] }],
    ]);
    await expect.element(page.getByLabelText("Location")).toHaveTextContent("/families/c-9");
  });

  it("shows a taken number under the phone field", async () => {
    network.post.mockRejectedValueOnce(httpError(409));
    const add = await openChildSheet();
    await fillChild(add);
    await add.getByRole("textbox", { name: "Name" }).nth(1).fill("Ana Lima");
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("+1 305 555 0199");
    await add.getByRole("button", { name: "Add child" }).click();
    await expect.element(add.getByText("Another Guardian already has this number.")).toBeVisible();
    expect(network.post).toHaveBeenCalledTimes(1);
  });

  it("keeps the sheet when the Child fails, then retries only the Child", async () => {
    network.post
      .mockResolvedValueOnce({ data: { id: "g-9", name: "Ana Lima" } })
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValueOnce({ data: { id: "c-9", name: "Luca Souza" } });
    const add = await openChildSheet();
    await fillChild(add);
    await add.getByRole("textbox", { name: "Name" }).nth(1).fill("Ana Lima");
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("+1 305 555 0199");
    await add.getByRole("button", { name: "Add child" }).click();

    await expect
      .element(add.getByRole("alert").filter({ hasText: "Ana Lima was added, but Luca Souza wasn’t. Try again." }))
      .toBeVisible();
    await expect.element(add.getByRole("button", { name: "Existing guardian" })).toHaveAttribute("aria-pressed", "true");
    await expect.element(add.getByRole("combobox", { name: "Guardian" })).toHaveValue("Ana Lima");
    expect(document.activeElement?.contains(document.querySelector('[role="alert"]'))).toBe(true);

    await add.getByRole("button", { name: "Add child" }).click();
    await expect.element(page.getByLabelText("Location")).toHaveTextContent("/families/c-9");
    expect(network.post.mock.calls.map(([url]) => url)).toEqual([
      "/api/clients",
      "/api/children",
      "/api/children",
    ]);
    expect(network.post.mock.calls[2][1]).toEqual({ ...CHILD_BODY, guardian_ids: ["g-9"] });
  });

  it("ticks the picked family's other live Guardians and posts them all", async () => {
    network.post.mockResolvedValue({ data: { id: "c-9", name: "Luca Souza" } });
    const add = await openChildSheet();
    await fillChild(add);
    await pickGuardian(add, "Laura Souza");
    // Archived Carla is not offered.
    await expect.element(add.getByRole("checkbox", { name: "Diego Souza" })).toBeChecked();
    await expect.element(add.getByRole("checkbox", { name: "Carla Souza" })).not.toBeInTheDocument();
    await add.getByRole("button", { name: "Add child" }).click();

    expect(network.post).toHaveBeenCalledTimes(1);
    expect(network.post).toHaveBeenCalledWith("/api/children", {
      ...CHILD_BODY,
      guardian_ids: ["g-1", "g-2"],
    });
    await expect.element(page.getByLabelText("Location")).toHaveTextContent("/families/c-9");
  });

  it("leaves out an unticked Guardian", async () => {
    network.post.mockResolvedValue({ data: { id: "c-9", name: "Luca Souza" } });
    const add = await openChildSheet();
    await fillChild(add);
    await pickGuardian(add, "Laura Souza");
    await add.getByRole("checkbox", { name: "Diego Souza" }).click();
    await add.getByRole("button", { name: "Add child" }).click();
    expect(network.post).toHaveBeenCalledWith("/api/children", {
      ...CHILD_BODY,
      guardian_ids: ["g-1"],
    });
  });

  it("hides Also belongs to when the family has no other live Guardian", async () => {
    const add = await openChildSheet();
    await pickGuardian(add, "Monica Rivera");
    await expect.element(add.getByRole("combobox", { name: "Guardian" })).toHaveValue("Monica Rivera");
    await expect.element(add.getByText("Also belongs to")).not.toBeInTheDocument();
  });

  it("says so when Guardians fail to load, and retries", async () => {
    serve({ "/api/clients": () => Promise.reject(httpError(500)) });
    const add = await openChildSheet();
    await add.getByRole("button", { name: "Existing guardian" }).click();
    await expect.element(add.getByText("Couldn’t load Guardians. Check your connection.")).toBeVisible();
  });

  it("offers a retry when the family fails to load", async () => {
    serve({ "/api/households/g-1": () => Promise.reject(httpError(500)) });
    const add = await openChildSheet();
    await pickGuardian(add, "Laura Souza");
    await expect
      .element(add.getByText("Couldn’t load Laura’s family. Check your connection."))
      .toBeVisible();
  });

  it("stacks the footer with the primary on top at 375px and does not scroll sideways at 320", async () => {
    await page.viewport(375, 800);
    const add = await openChildSheet();
    const cancel = (await add.getByRole("button", { name: "Cancel" }).element()).getBoundingClientRect();
    const primary = (await add.getByRole("button", { name: "Add child" }).element()).getBoundingClientRect();
    expect(primary.top).toBeLessThan(cancel.top);

    await page.viewport(320, 700);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  });

  it("ignores Escape and Cancel while the requests run", async () => {
    network.post.mockImplementation(() => new Promise(() => {}));
    const add = await openChildSheet();
    await fillChild(add);
    await add.getByRole("textbox", { name: "Name" }).nth(1).fill("Ana Lima");
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("+1 305 555 0199");
    await add.getByRole("button", { name: "Add child" }).click();
    await expect.element(add.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(childSheet()).toBeVisible();
  });
});
