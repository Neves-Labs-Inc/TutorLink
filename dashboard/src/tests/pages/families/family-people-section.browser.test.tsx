import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import FamilyPage from "@/pages/families/family-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";
import type {
  ClientRead,
  HouseholdHome,
  HouseholdRead,
} from "@/types/families";

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: network,
}));

const BRICKELL: HouseholdHome = {
  id: "h-1",
  label: "Dad’s",
  address: "1200 Brickell Ave, Apt 4, Miami FL",
  directions: "Gate code 4411. Park on the street.",
  archived: false,
  guardian_ids: ["g-1", "g-2"],
};

const OLD_ROAD: HouseholdHome = {
  id: "h-2",
  label: null,
  address: "88 Old Rd, Miami FL",
  directions: null,
  archived: true,
  guardian_ids: ["g-1"],
};

const HOUSEHOLD: HouseholdRead = {
  key: "g-1",
  name: "Laura & Diego Souza",
  archived: false,
  guardians: [
    { id: "g-1", name: "Laura Souza", phone_number: "+13055550100", archived: false },
    { id: "g-2", name: "Diego Souza", phone_number: "+13055550101", archived: false },
    { id: "g-3", name: "Ana Souza", phone_number: "+13055550102", archived: true },
  ],
  children: [
    { id: "c-1", name: "Sofia Souza", grade_level: 5, archived: false },
    { id: "c-2", name: "Tomás Souza", grade_level: 2, archived: false },
    { id: "c-3", name: "Old Souza", grade_level: 9, archived: true },
  ],
  homes: [BRICKELL, OLD_ROAD],
  next_booking: null,
};

function makeGuardian(
  id: string,
  name: string,
  overrides: Partial<ClientRead> = {},
): ClientRead {
  return {
    id,
    name,
    phone_number: "+13055550100",
    archived: false,
    homes: [],
    children: [],
    language: null,
    language_conversation_id: null,
    reminders: "opt_in",
    reminders_blocked_by_whatsapp: false,
    ...overrides,
  };
}

const LAURA = makeGuardian("g-1", "Laura Souza");
const DIEGO = makeGuardian("g-2", "Diego Souza", {
  phone_number: "+13055550101",
  language: "es",
  reminders: "never",
});
const ANA = makeGuardian("g-3", "Ana Souza", {
  phone_number: "+13055550102",
  archived: true,
});

function httpError(status: number, data: unknown): AxiosError {
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
const never = () => new Promise(() => {});

function familyResponses(household: HouseholdRead = HOUSEHOLD): Responses {
  return {
    "/api/households/g-1": ok(household),
    "/api/clients/g-1": ok(LAURA),
    "/api/clients/g-2": ok(DIEGO),
    "/api/clients/g-3": ok(ANA),
  };
}

function serve(responses: Responses): void {
  network.get.mockImplementation((url: string) => {
    const respond = responses[url];
    return respond
      ? respond()
      : Promise.reject(httpError(404, { detail: "Not found" }));
  });
}

function Location(): ReactNode {
  const location = useLocation();
  return (
    <output aria-label="Location">{`${location.pathname}${location.search}`}</output>
  );
}

function renderFamily() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/families/g-1"]}>
      <Routes>
        <Route
          path="/families/:memberId"
          element={
            <>
              <KitRoot theme="light" height="800px">
                <FamilyPage />
              </KitRoot>
              <Location />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const location = () => page.getByRole("status", { name: "Location" });
const guardians = () => page.getByRole("region", { name: /^Guardians/ });
const homes = () => page.getByRole("region", { name: /^Homes/ });
const sheet = (name: string) => page.getByRole("dialog", { name });

beforeEach(async () => {
  await page.viewport(1280, 900);
  for (const method of Object.values(network)) method.mockReset();
  serve(familyResponses());
  useAuthStore.setState({ status: "authenticated", role: "admin" });
});

describe("Guardians", () => {
  it("lists every Guardian with phone, language and reminders", async () => {
    await renderFamily();
    await expect
      .element(guardians().getByRole("heading", { name: "Guardians · 3" }))
      .toBeVisible();
    const diego = guardians().getByRole("button", {
      name: "Open Guardian details: Diego Souza",
    });
    await expect.element(diego).toHaveTextContent("+1 305 555 0101 · Spanish");
    await expect.element(diego).toHaveTextContent("Never asked");
    await expect
      .element(
        guardians().getByRole("button", { name: "Open Guardian details: Laura Souza" }),
      )
      .toHaveTextContent("Reminders on");
  });

  it("mutes an archived Guardian with its badge", async () => {
    await renderFamily();
    const ana = guardians().getByRole("button", {
      name: "Open Guardian details: Ana Souza",
    });
    await expect.element(ana).toHaveTextContent("Archived");
    await expect.element(ana).toHaveClass("text-(--tl-muted)");
  });

  it("opens a Guardian's details from the row", async () => {
    await renderFamily();
    await guardians()
      .getByRole("button", { name: "Open Guardian details: Diego Souza" })
      .click();
    await expect.element(page.getByRole("dialog", { name: "Diego Souza" })).toBeVisible();
    await expect.element(location()).toHaveTextContent("/families/g-1?guardian=g-2");
  });

  it("keeps the name while a Guardian's details load", async () => {
    serve({ ...familyResponses(), "/api/clients/g-2": never });
    await renderFamily();
    const diego = guardians().getByRole("button", {
      name: "Open Guardian details: Diego Souza",
    });
    await expect.element(diego).toHaveTextContent("Diego Souza");
    await expect.element(diego).not.toHaveTextContent("Spanish");
  });

  it("says when a Guardian's details failed", async () => {
    serve({
      ...familyResponses(),
      "/api/clients/g-2": () => Promise.reject(httpError(500, {})),
    });
    await renderFamily();
    await expect
      .element(
        guardians().getByRole("button", { name: "Open Guardian details: Diego Souza" }),
      )
      .toHaveTextContent("Couldn’t load details");
  });

  it("says when the family has no Guardians", async () => {
    serve(familyResponses({ ...HOUSEHOLD, guardians: [], homes: [] }));
    await renderFamily();
    await expect.element(guardians().getByText("No Guardians yet")).toBeVisible();
  });
});

describe("Add guardian", () => {
  async function openAddGuardian() {
    await renderFamily();
    await guardians().getByRole("button", { name: "Add guardian" }).click();
    return sheet("Add guardian");
  }

  it("links every live Child by default and can share a Home", async () => {
    network.post.mockResolvedValue({ data: makeGuardian("g-9", "Rosa Lima") });
    const add = await openAddGuardian();
    await expect.element(add.getByRole("checkbox", { name: "Sofia Souza" })).toBeChecked();
    await expect.element(add.getByRole("checkbox", { name: "Tomás Souza" })).toBeChecked();
    await expect.element(add.getByRole("checkbox", { name: "Old Souza" })).not.toBeInTheDocument();
    const brickell = add.getByRole("checkbox", {
      name: "Dad’s: 1200 Brickell Ave, Apt 4, Miami FL",
    });
    await expect.element(brickell).not.toBeChecked();
    await expect
      .element(add.getByRole("checkbox", { name: /Old Rd/ }))
      .not.toBeInTheDocument();

    await add.getByRole("textbox", { name: "Name" }).fill("Rosa Lima");
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("+1 305 555 0199");
    await add.getByRole("checkbox", { name: "Tomás Souza" }).click();
    await brickell.click();
    await add.getByRole("button", { name: "Add guardian" }).click();

    await expect.element(page.getByText("Rosa Lima added to the family.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/clients", {
      name: "Rosa Lima",
      phone_number: "+1 305 555 0199",
      child_ids: ["c-1"],
      home_ids: ["h-1"],
    });
    await expect.element(sheet("Add guardian")).not.toBeInTheDocument();
  });

  it("asks for a name, a number and at least one Child", async () => {
    const add = await openAddGuardian();
    await add.getByRole("checkbox", { name: "Sofia Souza" }).click();
    await add.getByRole("checkbox", { name: "Tomás Souza" }).click();
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("12");
    await add.getByRole("button", { name: "Add guardian" }).click();

    await expect.element(add.getByText("Enter the Guardian’s name.")).toBeVisible();
    await expect
      .element(add.getByText("Enter a WhatsApp number with country code."))
      .toBeVisible();
    await expect.element(add.getByText("Pick at least one Child.")).toBeVisible();
    expect(network.post).not.toHaveBeenCalled();
  });

  it.each([
    [409, "A client with that phone number already exists", "Another Guardian already has this number."],
    [
      400,
      "phone_number is not a phone number that can be dialled",
      "Enter a WhatsApp number the bot can reach, with country code.",
    ],
  ])("puts a %i about the number under the number", async (status, detail, message) => {
    network.post.mockRejectedValue(httpError(status, { detail }));
    const add = await openAddGuardian();
    await add.getByRole("textbox", { name: "Name" }).fill("Rosa Lima");
    const phone = add.getByRole("textbox", { name: "WhatsApp number" });
    await phone.fill("+1 305 555 0100");
    await add.getByRole("button", { name: "Add guardian" }).click();

    await expect.element(phone).toHaveAccessibleDescription(message);
    await expect.element(add.getByRole("alert")).not.toBeInTheDocument();
  });

  it("says when the Guardian couldn't be added", async () => {
    network.post.mockRejectedValue(httpError(500, {}));
    const add = await openAddGuardian();
    await add.getByRole("textbox", { name: "Name" }).fill("Rosa Lima");
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("+1 305 555 0100");
    await add.getByRole("button", { name: "Add guardian" }).click();

    await expect
      .element(add.getByRole("alert"))
      .toHaveTextContent("Couldn’t add Rosa Lima. Check your connection and try again.");
  });

  it("sends the only live Child without asking", async () => {
    network.post.mockResolvedValue({ data: makeGuardian("g-9", "Rosa Lima") });
    serve(
      familyResponses({
        ...HOUSEHOLD,
        children: [HOUSEHOLD.children[0]],
        homes: [],
      }),
    );
    const add = await openAddGuardian();
    await expect.element(add.getByRole("group", { name: "Linked to" })).not.toBeInTheDocument();
    await expect.element(add.getByRole("group", { name: "Lives at" })).not.toBeInTheDocument();
    await add.getByRole("textbox", { name: "Name" }).fill("Rosa Lima");
    await add.getByRole("textbox", { name: "WhatsApp number" }).fill("+1 305 555 0199");
    await add.getByRole("button", { name: "Add guardian" }).click();

    await expect.element(page.getByText("Rosa Lima added to the family.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/clients", {
      name: "Rosa Lima",
      phone_number: "+1 305 555 0199",
      child_ids: ["c-1"],
      home_ids: [],
    });
  });
});

describe("Homes", () => {
  it("shows a live Home with its owners, and archived ones apart", async () => {
    await renderFamily();
    await expect.element(homes().getByRole("heading", { name: "Homes · 1 live" })).toBeVisible();
    const card = homes().getByRole("listitem").filter({ hasText: "Brickell" });
    await expect.element(card).toHaveTextContent("Dad’s");
    await expect.element(card).toHaveTextContent("Gate code 4411. Park on the street.");
    await expect
      .element(homes().getByText("Archived · 1"))
      .toBeVisible();

    await card.getByRole("button", { name: "Diego Souza" }).click();
    await expect.element(location()).toHaveTextContent("/families/g-1?guardian=g-2");
  });

  it("says when the family has no Homes", async () => {
    serve(familyResponses({ ...HOUSEHOLD, homes: [] }));
    await renderFamily();
    await expect
      .element(homes().getByText("No Homes yet. Bookings can still be In office."))
      .toBeVisible();
    await expect.element(homes().getByText(/^Archived/)).not.toBeInTheDocument();
  });

  it("can't add a Home without a live Guardian", async () => {
    serve(
      familyResponses({
        ...HOUSEHOLD,
        guardians: [HOUSEHOLD.guardians[2]],
        homes: [],
      }),
    );
    await renderFamily();
    const add = homes().getByRole("button", { name: "Add home" });
    await expect.element(add).toBeDisabled();
    await expect
      .element(add)
      .toHaveAccessibleDescription("A Home is saved on a Guardian. Add a Guardian first.");
  });
});

describe("Add home", () => {
  it("saves the Home on every live Guardian by default", async () => {
    network.post.mockResolvedValue({ data: { id: "h-9" } });
    await renderFamily();
    await homes().getByRole("button", { name: "Add home" }).click();
    const add = sheet("Add home");
    await expect.element(add.getByRole("checkbox", { name: "Laura Souza" })).toBeChecked();
    await expect.element(add.getByRole("checkbox", { name: "Diego Souza" })).toBeChecked();
    await expect.element(add.getByRole("checkbox", { name: "Ana Souza" })).not.toBeInTheDocument();

    await add.getByRole("textbox", { name: "Address" }).fill("5600 NW 105th Ct, Doral FL");
    await add.getByRole("textbox", { name: "Directions for Staff" }).fill("Side door.");
    await add.getByRole("button", { name: "Add home" }).click();

    await expect.element(page.getByText("Home added.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/homes", {
      address: "5600 NW 105th Ct, Doral FL",
      label: null,
      directions: "Side door.",
      guardian_ids: ["g-1", "g-2"],
    });
  });

  it("needs an address and at least one Guardian", async () => {
    await renderFamily();
    await homes().getByRole("button", { name: "Add home" }).click();
    const add = sheet("Add home");
    await add.getByRole("checkbox", { name: "Laura Souza" }).click();
    await add.getByRole("checkbox", { name: "Diego Souza" }).click();
    await add.getByRole("button", { name: "Add home" }).click();

    await expect
      .element(add.getByRole("textbox", { name: "Address" }))
      .toHaveAccessibleDescription("Enter the full address.");
    await expect.element(add.getByText("Pick at least one Guardian.")).toBeVisible();
    expect(network.post).not.toHaveBeenCalled();
  });

  it("hides Whose home with one live Guardian and saves on them", async () => {
    network.post.mockResolvedValue({ data: { id: "h-9" } });
    serve(
      familyResponses({
        ...HOUSEHOLD,
        guardians: HOUSEHOLD.guardians.filter((guardian) => guardian.id !== "g-2"),
      }),
    );
    await renderFamily();
    await homes().getByRole("button", { name: "Add home" }).click();
    const add = sheet("Add home");
    await expect.element(add.getByRole("group", { name: "Whose home" })).not.toBeInTheDocument();
    await add.getByRole("textbox", { name: "Address" }).fill("1 Main St");
    await add.getByRole("button", { name: "Add home" }).click();

    await expect.element(page.getByText("Home added.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith(
      "/api/homes",
      expect.objectContaining({ guardian_ids: ["g-1"] }),
    );
  });
});

describe("Edit home", () => {
  const editBrickell = () =>
    homes().getByRole("button", { name: "Edit 1200 Brickell Ave, Apt 4, Miami FL" });

  it("saves changed fields, then the new owners", async () => {
    serve(
      familyResponses({
        ...HOUSEHOLD,
        homes: [{ ...BRICKELL, guardian_ids: ["g-1"] }, OLD_ROAD],
      }),
    );
    network.patch.mockResolvedValue({ data: {} });
    network.post.mockResolvedValue({ data: {} });
    await renderFamily();
    await editBrickell().click();
    const edit = sheet("Edit home");
    await expect.element(edit.getByRole("textbox", { name: "Label" })).toHaveValue("Dad’s");
    await expect.element(edit.getByRole("checkbox", { name: "Laura Souza" })).toBeChecked();
    await expect.element(edit.getByRole("checkbox", { name: "Diego Souza" })).not.toBeChecked();

    await edit.getByRole("textbox", { name: "Label" }).fill("");
    await edit.getByRole("textbox", { name: "Directions for Staff" }).fill("  ");
    await edit.getByRole("checkbox", { name: "Diego Souza" }).click();
    await edit.getByRole("button", { name: "Save home" }).click();

    await expect.element(page.getByText("Home saved.")).toBeVisible();
    // A PATCH null leaves the field alone on the server; "" clears it.
    expect(network.patch).toHaveBeenCalledWith("/api/homes/h-1", {
      label: "",
      directions: "",
    });
    expect(network.post).toHaveBeenCalledWith("/api/homes/h-1/guardians", {
      guardian_id: "g-2",
    });
    expect(network.delete).not.toHaveBeenCalled();
  });

  it("keeps what saved and explains a refused unshare", async () => {
    network.patch.mockResolvedValue({ data: {} });
    network.delete.mockRejectedValue(
      httpError(409, {
        detail: "Home is lost to upcoming bookings",
        booking_ids: ["b-1", "b-2"],
      }),
    );
    await renderFamily();
    await editBrickell().click();
    const edit = sheet("Edit home");
    await edit.getByRole("textbox", { name: "Directions for Staff" }).fill("Ring twice.");
    await edit.getByRole("checkbox", { name: "Diego Souza" }).click();
    await edit.getByRole("button", { name: "Save home" }).click();

    await expect
      .element(edit.getByRole("alert"))
      .toHaveTextContent(
        "Diego Souza can’t be taken off this Home: 2 upcoming Bookings for their Children are there. Change them to another Location first.",
      );
    expect(network.patch).toHaveBeenCalledWith("/api/homes/h-1", {
      directions: "Ring twice.",
    });
    expect(network.delete).toHaveBeenCalledWith("/api/homes/h-1/guardians/g-2");
    await expect.element(edit.getByRole("checkbox", { name: "Diego Souza" })).toBeChecked();
    await expect
      .element(edit.getByRole("textbox", { name: "Directions for Staff" }))
      .toHaveValue("Ring twice.");

    // Saving again doesn't resend the fields that already saved.
    network.patch.mockClear();
    await edit.getByRole("button", { name: "Save home" }).click();
    await expect.element(page.getByText("Home saved.")).toBeVisible();
    expect(network.patch).not.toHaveBeenCalled();
  });
  it("tries every unshare and names each one refused", async () => {
    serve({
      ...familyResponses({
        ...HOUSEHOLD,
        guardians: HOUSEHOLD.guardians.map((guardian) => ({
          ...guardian,
          archived: false,
        })),
        homes: [{ ...BRICKELL, guardian_ids: ["g-1", "g-2", "g-3"] }],
      }),
      "/api/clients/g-3": ok({ ...ANA, archived: false }),
    });
    network.delete.mockImplementation((url: string) =>
      url.endsWith("/g-2")
        ? Promise.reject(httpError(409, { detail: "lost", booking_ids: ["b-1"] }))
        : Promise.resolve({ data: {} }),
    );
    await renderFamily();
    await editBrickell().click();
    const edit = sheet("Edit home");
    await edit.getByRole("checkbox", { name: "Diego Souza" }).click();
    await edit.getByRole("checkbox", { name: "Ana Souza" }).click();
    await edit.getByRole("button", { name: "Save home" }).click();

    await expect
      .element(edit.getByRole("alert"))
      .toHaveTextContent(
        "Diego Souza can’t be taken off this Home: 1 upcoming Booking for their Children is there. Change it to another Location first.",
      );
    expect(network.delete).toHaveBeenCalledWith("/api/homes/h-1/guardians/g-2");
    expect(network.delete).toHaveBeenCalledWith("/api/homes/h-1/guardians/g-3");
    await expect.element(edit.getByRole("checkbox", { name: "Diego Souza" })).toBeChecked();
    await expect.element(edit.getByRole("checkbox", { name: "Ana Souza" })).not.toBeChecked();
  });
});

describe("Archive home", () => {
  const archiveBrickell = () =>
    homes().getByRole("button", { name: "Archive 1200 Brickell Ave, Apt 4, Miami FL" });

  it("confirms, then archives and moves the Home under Archived", async () => {
    let household = HOUSEHOLD;
    serve({ ...familyResponses(), "/api/households/g-1": () => Promise.resolve({ data: household }) });
    network.post.mockImplementation(() => {
      household = {
        ...HOUSEHOLD,
        homes: [{ ...BRICKELL, archived: true }, OLD_ROAD],
      };
      return Promise.resolve({ data: {} });
    });
    await renderFamily();
    await archiveBrickell().click();
    const confirm = page.getByRole("alertdialog", { name: "Archive this Home?" });
    await expect
      .element(confirm)
      .toHaveTextContent(
        "1200 Brickell Ave, Apt 4, Miami FL can’t be picked for new Bookings. Past Bookings keep it.",
      );
    await confirm.getByRole("button", { name: "Archive home" }).click();

    await expect.element(page.getByText("Home archived.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/archive", { type: "home", id: "h-1" });
    await expect.element(homes().getByText("Archived · 2")).toBeVisible();
    await expect.element(homes().getByRole("heading", { name: "Homes · 0 live" })).toBeVisible();
    await expect.element(homes().getByRole("button", { name: "Add home" })).toHaveFocus();
  });

  it("explains a Home that still has Bookings", async () => {
    network.post.mockRejectedValue(
      httpError(409, {
        detail: "Home has upcoming bookings; cancel or move them first",
        booking_ids: ["b-1", "b-2", "b-3"],
      }),
    );
    await renderFamily();
    await archiveBrickell().click();
    await page
      .getByRole("alertdialog", { name: "Archive this Home?" })
      .getByRole("button", { name: "Archive home" })
      .click();

    const blocked = page.getByRole("dialog", { name: "This Home still has Bookings" });
    await expect
      .element(blocked)
      .toHaveTextContent(
        "3 upcoming Bookings are at 1200 Brickell Ave, Apt 4, Miami FL. Change them to another Location in Bookings first, then archive the Home.",
      );
    await blocked.getByRole("button", { name: "Got it" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the Home when asked", async () => {
    await renderFamily();
    await archiveBrickell().click();
    await page.getByRole("button", { name: "Keep home" }).click();
    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(network.post).not.toHaveBeenCalled();
  });

  it("restores an archived Home", async () => {
    network.post.mockResolvedValue({ data: {} });
    await renderFamily();
    await homes().getByText("Archived · 1").click();
    await homes().getByRole("button", { name: "Restore 88 Old Rd, Miami FL" }).click();

    await expect.element(page.getByText("Home restored.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/restore", { type: "home", id: "h-2" });
  });
});

describe("layout", () => {
  function getBox(region: ReturnType<typeof guardians>): DOMRect {
    return region.element().getBoundingClientRect();
  }

  it("puts Guardians and Homes side by side at 1280", async () => {
    await renderFamily();
    await expect.element(homes()).toBeVisible();
    expect(getBox(homes()).top).toBe(getBox(guardians()).top);
    expect(getBox(homes()).left).toBeGreaterThan(getBox(guardians()).right);
  });

  it("stacks Guardians over Homes at 390", async () => {
    await page.viewport(390, 844);
    await renderFamily();
    await expect.element(homes()).toBeVisible();
    expect(getBox(homes()).top).toBeGreaterThan(getBox(guardians()).bottom);
  });

  it.each([375, 320])(
    "fits a long name at %ipx without sideways scroll",
    async (width) => {
      const longName = "Diego Souza-Okonkwo Fitzgerald";
      serve({
        ...familyResponses({
          ...HOUSEHOLD,
          guardians: HOUSEHOLD.guardians.map((guardian) =>
            guardian.id === "g-2" ? { ...guardian, name: longName } : guardian,
          ),
        }),
        "/api/clients/g-2": ok({ ...DIEGO, name: longName }),
      });
      await page.viewport(width, 740);
      await renderFamily();
      await expect.element(homes()).toBeVisible();
      // The kit root is overflow-hidden; the page scrolls inside it.
      const scroller = document.querySelector<HTMLElement>("[data-kit-scroll]");
      expect(scroller).not.toBeNull();
      expect(scroller?.scrollWidth).toBeLessThanOrEqual(scroller?.clientWidth ?? 0);
      const archive = homes().getByRole("button", { name: /^Archive 1200/ });
      expect(archive.element().getBoundingClientRect().right).toBeLessThanOrEqual(width);
    },
  );
});
