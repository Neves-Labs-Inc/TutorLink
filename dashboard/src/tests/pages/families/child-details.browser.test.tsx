import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import type { Theme } from "@/components/kit/tokens";
import { BookingOverlaysContext } from "@/hooks/use-booking-overlays";
import type { BookingOverlays } from "@/hooks/use-booking-overlays";
import FamilyPage from "@/pages/families/family-page";
import { renderWithProviders } from "@/test/render-with-providers";
import type {
  ChildDetail,
  ClientRead,
  ClientSummary,
  HouseholdRead,
  Page,
} from "@/types/families";

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, post: network.post, patch: network.patch },
}));

const HOUSEHOLD: HouseholdRead = {
  key: "g-1",
  name: "Laura & Diego Souza",
  archived: false,
  guardians: [
    { id: "g-1", name: "Laura Souza", phone_number: "+13055550100", archived: false },
    { id: "g-2", name: "Diego Souza", phone_number: "+13055550101", archived: true },
  ],
  children: [{ id: "c-1", name: "Sofia Souza", grade_level: 5, archived: false }],
  homes: [],
  next_booking: null,
};

const SOFIA: ChildDetail = {
  id: "c-1",
  name: "Sofia Souza",
  date_of_birth: "2016-03-04",
  grade_level: 5,
  school_name: "Lincoln Elementary",
  notes: "Allergic to nuts.",
  archived: false,
  upcoming_session_count: 3,
  next_session: {
    id: "b-1",
    scheduled_date: "2026-10-15",
    start_time: "15:30:00",
    end_time: "16:30:00",
    tutor: { id: "t-1", name: "Ana" },
    subject: { id: "s-1", name: "Math" },
  },
  guardians: [
    {
      id: "g-1",
      name: "Laura Souza",
      phone_number: "+13055550100",
      archived: false,
      language: "en",
      reminders: "opt_in",
      reminders_blocked_by_whatsapp: false,
    },
    {
      id: "g-2",
      name: "Diego Souza",
      phone_number: "+13055550101",
      archived: true,
      language: "es",
      reminders: "never",
      reminders_blocked_by_whatsapp: false,
    },
  ],
  homes: [
    {
      id: "h-1",
      label: "Dad’s",
      address: "1200 Brickell Ave, Miami",
      directions: null,
      archived: false,
      guardians: [{ id: "g-1", name: "Laura Souza" }],
    },
    {
      id: "h-2",
      label: "Old flat",
      address: "9 Gone St",
      directions: null,
      archived: true,
      guardians: [{ id: "g-1", name: "Laura Souza" }],
    },
  ],
  levels: [],
  evaluated: null,
  assigned_tutors: [],
  evaluation_run_by: null,
};

function makeGuardian(id: string, name: string): ClientRead {
  return {
    id,
    name,
    phone_number: "+13055550100",
    archived: false,
    homes: [],
    children: [],
    language: null,
    language_conversation_id: null,
    reminders: "never",
    reminders_blocked_by_whatsapp: false,
  };
}

function summary(id: string, name: string, phone: string): ClientSummary {
  return {
    id,
    name,
    phone_number: phone,
    archived: false,
    home_count: 0,
    child_count: 0,
    language: "en",
    reminders: "never",
    reminders_blocked_by_whatsapp: false,
    children: [],
  };
}

const ACTIVE_GUARDIANS: Page<ClientSummary> = {
  items: [
    summary("g-1", "Laura Souza", "+13055550100"),
    summary("g-7", "Marta Lima", "+13055550177"),
  ],
  total: 2,
  page: 1,
  page_size: 100,
};

function httpError(status: number, detail = String(status)): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(String(status), "ERR_BAD_REQUEST", config, null, {
    status,
    statusText: String(status),
    headers: {},
    config,
    data: { detail },
  });
}

type Responses = Record<string, () => Promise<unknown>>;

const SETTLE_MS = 300;

const ok = (data: unknown) => () => Promise.resolve({ data });
const never = () => new Promise(() => {});

let child: ChildDetail = SOFIA;
let responses: Responses = {};

function serve(overrides: Responses = {}): void {
  responses = {
    "/api/households/g-1": ok(HOUSEHOLD),
    "/api/children/c-1": () => Promise.resolve({ data: child }),
    "/api/clients/g-1": ok(makeGuardian("g-1", "Laura Souza")),
    "/api/clients/g-2": ok(makeGuardian("g-2", "Diego Souza")),
    "/api/clients": ok(ACTIVE_GUARDIANS),
    ...overrides,
  };
}

const bookingOverlays: BookingOverlays = {
  openBooking: vi.fn(),
  openNewBooking: vi.fn(),
  openChangeBooking: vi.fn(),
};

function LocationProbe(): ReactNode {
  const location = useLocation();
  return (
    <output aria-label="Location">{`${location.pathname}${location.search}`}</output>
  );
}

const startUrl = window.location.href;

// A real browser history: unlinking the page's Guardian checks it to see
// whether the user is still on the entry they unlinked from.
function renderAt(path = "/families/g-1?child=c-1", theme: Theme = "light") {
  window.history.pushState(null, "", path);
  return renderWithProviders(
    <BrowserRouter>
      <BookingOverlaysContext.Provider value={bookingOverlays}>
        <Routes>
          <Route
            path="/families/:memberId"
            element={
              <KitRoot theme={theme} height="640px">
                <FamilyPage />
              </KitRoot>
            }
          />
        </Routes>
      </BookingOverlaysContext.Provider>
      <LocationProbe />
    </BrowserRouter>,
  );
}

const overlay = (name = "Sofia Souza") => page.getByRole("dialog", { name });
const sheet = (name: string) => page.getByRole("dialog", { name });
const location = () => page.getByRole("status", { name: "Location" });

async function openMenuItem(name: string | RegExp): Promise<void> {
  await overlay().getByRole("button", { name: "More actions" }).click();
  await page
    .getByRole("dialog", { name: "Sofia Souza" })
    .getByRole("button", { name })
    .last()
    .click();
}

beforeEach(async () => {
  // Only Date: "10 years old" is counted from the business's today.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00-04:00"));
  await page.viewport(1280, 800);
  child = SOFIA;
  network.get.mockReset();
  network.post.mockReset();
  network.patch.mockReset();
  vi.mocked(bookingOverlays.openNewBooking).mockReset();
  serve();
  network.get.mockImplementation((url: string) => {
    const respond = responses[url];
    return respond ? respond() : Promise.reject(httpError(404));
  });
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", startUrl);
});

describe("child details body", () => {
  it.each(["light", "dark"] as const)(
    "shows the profile, next booking and Child notes (%s)",
    async (theme) => {
      await renderAt(undefined, theme);
      const details = overlay();
      await expect
        .element(details.getByText("Mar 4, 2016 · 10 years old"))
        .toBeVisible();
      await expect.element(details.getByText("Grade 5")).toBeVisible();
      await expect.element(details.getByText("Lincoln Elementary")).toBeVisible();
      await expect
        .element(details.getByText("Thu, Oct 15, 3:30 PM · Ana"))
        .toBeVisible();
      await expect.element(details.getByText("3 upcoming Bookings")).toBeVisible();
      await expect.element(details.getByText("Allergic to nuts.")).toBeVisible();
    },
  );

  it("words every missing value", async () => {
    child = {
      ...SOFIA,
      date_of_birth: null,
      grade_level: null,
      school_name: "",
      notes: null,
      next_session: null,
      upcoming_session_count: 0,
    };
    await renderAt();
    const details = overlay();
    await expect.element(details.getByText("Grade not set")).toBeVisible();
    await expect.element(details.getByText("Nothing booked")).toBeVisible();
    await expect.element(details.getByText("No Child notes yet")).toBeVisible();
    expect(details.getByText("—", { exact: true }).elements()).toHaveLength(2);
  });

  it("lists the Guardians with phone, language and badge", async () => {
    await renderAt();
    const details = overlay();
    await expect
      .element(details.getByRole("heading", { name: "Guardians · 2" }))
      .toBeVisible();
    await expect
      .element(details.getByText("+1 (305) 555-0100 · English"))
      .toBeVisible();
    await expect
      .element(details.getByText("+1 (305) 555-0101 · Spanish"))
      .toBeVisible();
    await expect.element(details.getByText("Reminders on")).toBeVisible();
    await expect.element(details.getByText("Archived")).toBeVisible();
  });

  it("says Guardian for one", async () => {
    child = { ...SOFIA, guardians: [SOFIA.guardians[0]] };
    await renderAt();
    await expect
      .element(overlay().getByRole("heading", { name: "Guardian", exact: true }))
      .toBeVisible();
  });

  it("opens a Guardian stacked, and Back returns to the Child", async () => {
    await page.viewport(375, 740);
    await renderAt();
    await overlay()
      .getByRole("button", { name: "Open Guardian details: Laura Souza" })
      .click();
    await expect.element(overlay("Laura Souza")).toBeVisible();
    await expect.element(location()).toHaveTextContent("/families/g-1?guardian=g-1");

    await overlay("Laura Souza").getByRole("button", { name: "Sofia Souza" }).click();
    await expect.element(overlay("Laura Souza")).not.toBeInTheDocument();
    await expect.element(overlay()).toBeVisible();
    await expect.element(location()).toHaveTextContent("/families/g-1?child=c-1");
  });

  it("lists where the Child can be booked, and an owner link opens them", async () => {
    await renderAt();
    const details = overlay();
    await expect
      .element(details.getByRole("heading", { name: "Can be booked at" }))
      .toBeVisible();
    await expect.element(details.getByText("Dad’s")).toBeVisible();
    await expect.element(details.getByText("1200 Brickell Ave, Miami")).toBeVisible();
    await expect.element(details.getByText("Old flat")).not.toBeInTheDocument();
    await expect.element(details.getByText("In office")).toBeVisible();

    await details.getByRole("button", { name: "Laura Souza’s Home" }).click();
    await expect.element(overlay("Laura Souza")).toBeVisible();
  });

  it("shows only In office without Homes", async () => {
    child = { ...SOFIA, homes: [] };
    await renderAt();
    await expect.element(overlay().getByText("In office")).toBeVisible();
    await expect
      .element(overlay().getByRole("button", { name: /’s Home$/ }))
      .not.toBeInTheDocument();
  });

  it("shows a pushed page with the family's Back on a phone", async () => {
    await page.viewport(375, 740);
    await renderAt(undefined, "dark");
    await expect
      .element(overlay().getByRole("button", { name: "Laura & Diego Souza" }))
      .toBeVisible();
    await expect
      .element(overlay().getByRole("button", { name: "Book evaluation" }))
      .toBeVisible();
  });

  it("shows a skeleton while loading", async () => {
    serve({ "/api/children/c-1": never });
    await renderAt();
    await expect
      .element(
        overlay("Child details").getByRole("status", {
          name: "Loading Child details",
        }),
      )
      .toBeVisible();
  });
});

describe("footer", () => {
  it("books an evaluation for a Child not yet Evaluated", async () => {
    await renderAt();
    await overlay().getByRole("button", { name: "Book evaluation" }).click();
    expect(bookingOverlays.openNewBooking).toHaveBeenCalledWith({
      kind: "evaluation",
      childId: "c-1",
    });
  });

  it("opens a new booking for an Evaluated Child", async () => {
    child = {
      ...SOFIA,
      evaluated: { at: "2026-10-01T10:00:00-04:00", by: { id: "t-1", name: "Ana" } },
    };
    await renderAt();
    await overlay().getByRole("button", { name: "New booking" }).click();
    expect(bookingOverlays.openNewBooking).toHaveBeenCalledWith({ childId: "c-1" });
  });

  it("has no footer when archived", async () => {
    child = { ...SOFIA, archived: true };
    await renderAt();
    await expect.element(overlay().getByText("Archived").first()).toBeVisible();
    await expect
      .element(overlay().getByRole("button", { name: "Book evaluation" }))
      .not.toBeInTheDocument();
  });
});

describe("edit details", () => {
  it("saves the changed fields, then updates the overlay and toasts", async () => {
    network.patch.mockImplementation(
      (_url: string, changes: Partial<ChildDetail>) => {
        child = { ...child, ...changes };
        return Promise.resolve({ data: child });
      },
    );
    await renderAt();
    await openMenuItem(/Edit details/);
    const edit = sheet("Edit details");
    await expect
      .element(
        edit.getByText(
          "Tutors see these with each Session: needs, allergies, how to approach sessions.",
        ),
      )
      .toBeVisible();
    await edit.getByRole("textbox", { name: "Name" }).fill("Sofia Lima");
    await edit.getByRole("textbox", { name: "School" }).fill("Coral Park");
    await edit.getByRole("textbox", { name: "Child notes" }).fill("");
    await edit.getByRole("button", { name: "Save details" }).click();

    await expect.element(page.getByText("Details saved.")).toBeVisible();
    expect(network.patch).toHaveBeenCalledWith("/api/children/c-1", {
      name: "Sofia Lima",
      school_name: "Coral Park",
      notes: "",
    });
    await expect.element(sheet("Edit details")).not.toBeInTheDocument();
    await expect.element(overlay("Sofia Lima").getByText("Coral Park")).toBeVisible();
  });

  it("asks for a name", async () => {
    await renderAt();
    await openMenuItem(/Edit details/);
    const edit = sheet("Edit details");
    await edit.getByRole("textbox", { name: "Name" }).fill(" ");
    await edit.getByRole("button", { name: "Save details" }).click();
    await expect.element(edit.getByText("Enter the Child’s name.")).toBeVisible();
    expect(network.patch).not.toHaveBeenCalled();
  });

  it("shows a refused date of birth under its field", async () => {
    network.patch.mockRejectedValue(
      httpError(400, "date_of_birth must be a real date between 1990-01-01 and today"),
    );
    await renderAt();
    await openMenuItem(/Edit details/);
    const edit = sheet("Edit details");
    await edit.getByLabelText("Date of birth").fill("2027-01-01");
    await edit.getByRole("button", { name: "Save details" }).click();
    await expect.element(edit.getByText("Enter a real date of birth.")).toBeVisible();
    expect(network.patch).toHaveBeenCalledWith("/api/children/c-1", {
      date_of_birth: "2027-01-01",
    });
  });

  it("shows the failure line when the save fails", async () => {
    network.patch.mockRejectedValue(httpError(500));
    await renderAt();
    await openMenuItem(/Edit details/);
    const edit = sheet("Edit details");
    await edit.getByRole("textbox", { name: "School" }).fill("Coral Park");
    await edit.getByRole("button", { name: "Save details" }).click();
    await expect
      .element(
        edit.getByText("Couldn’t save details. Check your connection and try again."),
      )
      .toBeVisible();
  });
});

describe("change guardians", () => {
  const guardiansSheet = () => sheet("Guardians of Sofia");

  it("links an active Guardian from another family", async () => {
    const marta = {
      id: "g-7",
      name: "Marta Lima",
      phone_number: "+13055550177",
      archived: false,
      language: "en" as const,
      reminders: "never" as const,
      reminders_blocked_by_whatsapp: false,
    };
    network.post.mockImplementation(() => {
      child = { ...child, guardians: [...child.guardians, marta] };
      return Promise.resolve({ data: {} });
    });
    await renderAt();
    await openMenuItem(/Change guardians/);
    const picker = guardiansSheet();
    await picker.getByRole("combobox", { name: "Guardian" }).click();
    await page.getByRole("option", { name: /Marta Lima/ }).click();
    await picker.getByRole("button", { name: "Link guardian" }).click();

    await expect
      .element(page.getByText("Marta Lima linked to Sofia Souza."))
      .toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/children/c-1/guardians", {
      guardian_id: "g-7",
    });
    await expect
      .element(picker.getByRole("button", { name: "Unlink Marta Lima" }))
      .toBeVisible();
  });

  it("only offers Guardians not already linked", async () => {
    await renderAt();
    await openMenuItem(/Change guardians/);
    await guardiansSheet().getByRole("combobox", { name: "Guardian" }).click();
    await expect.element(page.getByRole("option", { name: /Marta Lima/ })).toBeVisible();
    await expect
      .element(page.getByRole("option", { name: /Laura Souza/ }))
      .not.toBeInTheDocument();
  });

  it("unlinks with an Undo toast that re-links", async () => {
    network.patch.mockImplementation(
      (_url: string, changes: { guardian_ids: string[] }) => {
        child = {
          ...child,
          guardians: SOFIA.guardians.filter((guardian) =>
            changes.guardian_ids.includes(guardian.id),
          ),
        };
        return Promise.resolve({ data: {} });
      },
    );
    network.post.mockImplementation(() => {
      child = SOFIA;
      return Promise.resolve({ data: {} });
    });
    await renderAt();
    await openMenuItem(/Change guardians/);
    await guardiansSheet().getByRole("button", { name: "Unlink Diego Souza" }).click();

    await expect
      .element(page.getByText("Diego Souza unlinked from Sofia Souza."))
      .toBeVisible();
    expect(network.patch).toHaveBeenCalledWith("/api/children/c-1", {
      guardian_ids: ["g-1"],
    });
    await expect
      .element(guardiansSheet().getByRole("button", { name: "Unlink Diego Souza" }))
      .not.toBeInTheDocument();
    await expect
      .element(guardiansSheet().getByRole("button", { name: "Unlink Laura Souza" }))
      .toBeDisabled();
    await expect
      .element(guardiansSheet().getByText("A Child needs at least one Guardian."))
      .toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    expect(network.post).toHaveBeenCalledWith("/api/children/c-1/guardians", {
      guardian_id: "g-2",
    });
    await expect
      .element(guardiansSheet().getByRole("button", { name: "Unlink Diego Souza" }))
      .toBeVisible();
  });

  it("follows the Child to their other family when the page's Guardian is unlinked", async () => {
    const diegoFamily: HouseholdRead = {
      ...HOUSEHOLD,
      key: "g-2",
      name: "Diego Souza",
      guardians: [HOUSEHOLD.guardians[1]],
    };
    serve({
      // Once Laura is unlinked, her family no longer has Sofia.
      "/api/households/g-1": () =>
        Promise.resolve({
          data:
            child.guardians.length === 1 ? { ...HOUSEHOLD, children: [] } : HOUSEHOLD,
        }),
      "/api/households/g-2": ok(diegoFamily),
    });
    network.patch.mockImplementation(() => {
      child = { ...child, guardians: [SOFIA.guardians[1]] };
      return Promise.resolve({ data: {} });
    });
    network.post.mockImplementation(() => {
      child = SOFIA;
      return Promise.resolve({ data: {} });
    });
    await renderAt();
    await openMenuItem(/Change guardians/);
    // Watches every render from the click on, so a flash mid-move counts.
    let hasShownNotInFamily = false;
    const watcher = new MutationObserver(() => {
      if (document.body.textContent?.includes("This Child isn’t in this family.")) {
        hasShownNotInFamily = true;
      }
    });
    watcher.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    await guardiansSheet().getByRole("button", { name: "Unlink Laura Souza" }).click();

    await expect.element(location()).toHaveTextContent("/families/g-2?child=c-1");
    await expect
      .element(page.getByText("Laura Souza unlinked from Sofia Souza."))
      .toBeVisible();
    await expect.element(guardiansSheet()).toBeVisible();
    await expect
      .element(guardiansSheet().getByRole("button", { name: "Unlink Diego Souza" }))
      .toBeDisabled();
    // Let the refresh after the move settle too.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    watcher.disconnect();
    expect(hasShownNotInFamily).toBe(false);
    // The flash is a race (the move renders as a transition), so also check
    // its cause: Laura's family, now without Sofia, isn't fetched again.
    const lauraFamilyGets = network.get.mock.calls.filter(
      ([url]) => url === "/api/households/g-1",
    );
    expect(lauraFamilyGets).toHaveLength(1);
    // Focus stays in the sheet (on the list, or the panel itself if the
    // kit pulls it back in), never on the page behind.
    await expect
      .poll(() => guardiansSheet().element().contains(document.activeElement))
      .toBe(true);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .element(guardiansSheet().getByRole("button", { name: "Unlink Laura Souza" }))
      .toBeVisible();
    await expect.element(location()).toHaveTextContent("/families/g-2?child=c-1");
  });

  it("stays put when the user leaves the Child before unlinking the page's Guardian finishes", async () => {
    serve({
      "/api/households/g-1": () =>
        Promise.resolve({
          data:
            child.guardians.length === 1 ? { ...HOUSEHOLD, children: [] } : HOUSEHOLD,
        }),
      "/api/households/g-2": ok({ ...HOUSEHOLD, key: "g-2" }),
    });
    let finishUnlink: (value: unknown) => void = () => {};
    network.patch.mockImplementation(
      () => new Promise((resolve) => (finishUnlink = resolve)),
    );
    await renderAt();
    await openMenuItem(/Change guardians/);
    await guardiansSheet().getByRole("button", { name: "Unlink Laura Souza" }).click();
    await expect.poll(() => network.patch.mock.calls.length).toBe(1);

    // The browser's Back closes the Child while the PATCH is out.
    window.history.back();
    await expect.element(location()).toHaveTextContent(/^\/families\/g-1$/);
    child = { ...child, guardians: [SOFIA.guardians[1]] };
    finishUnlink({ data: {} });

    await expect
      .element(page.getByText("Laura Souza unlinked from Sofia Souza."))
      .toBeVisible();
    expect(window.location.pathname + window.location.search).toBe("/families/g-1");
    await expect.element(overlay()).not.toBeInTheDocument();
    // Laura's family, still on screen, drops Sofia.
    await expect.element(page.getByText("Sofia Souza")).not.toBeInTheDocument();
  });

  it("still words a failed Undo after the user has left the Child", async () => {
    network.patch.mockImplementation(() => {
      child = { ...child, guardians: [SOFIA.guardians[0]] };
      return Promise.resolve({ data: {} });
    });
    network.post.mockRejectedValue(httpError(500));
    await renderAt();
    await openMenuItem(/Change guardians/);
    await guardiansSheet().getByRole("button", { name: "Unlink Diego Souza" }).click();
    await expect.element(page.getByRole("button", { name: "Undo" })).toBeVisible();

    window.history.back();
    await expect.element(overlay()).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Undo" }).click();

    await expect
      .element(page.getByText("Couldn’t link Diego Souza. Try again."))
      .toBeVisible();
  });

  it("holds every other link and unlink while an unlink is in flight", async () => {
    const marta = { ...SOFIA.guardians[0], id: "g-7", name: "Marta Lima" };
    child = { ...SOFIA, guardians: [...SOFIA.guardians, marta] };
    let finishUnlink: (value: unknown) => void = () => {};
    network.patch.mockImplementation(
      () => new Promise((resolve) => (finishUnlink = resolve)),
    );
    await renderAt();
    await openMenuItem(/Change guardians/);
    const picker = guardiansSheet();
    await picker.getByRole("button", { name: "Unlink Diego Souza" }).click();

    await expect
      .element(picker.getByRole("button", { name: "Unlink Diego Souza" }))
      .toHaveAttribute("aria-busy", "true");
    await expect
      .element(picker.getByRole("button", { name: "Unlink Laura Souza" }))
      .toBeDisabled();
    await expect
      .element(picker.getByRole("button", { name: "Unlink Marta Lima" }))
      .toBeDisabled();
    await expect
      .element(picker.getByRole("button", { name: "Link guardian" }))
      .toBeDisabled();
    expect(network.patch).toHaveBeenCalledTimes(1);

    child = { ...child, guardians: [SOFIA.guardians[0], marta] };
    finishUnlink({ data: {} });
    await expect
      .element(page.getByText("Diego Souza unlinked from Sofia Souza."))
      .toBeVisible();
    await expect
      .element(picker.getByRole("button", { name: "Unlink Laura Souza" }))
      .toBeEnabled();
  });

  it("stays quiet when a second Undo finds them linked already", async () => {
    network.patch.mockImplementation(() => {
      child = { ...child, guardians: [SOFIA.guardians[0]] };
      return Promise.resolve({ data: {} });
    });
    network.post.mockRejectedValue(httpError(409, "That guardian is already linked to this child"));
    await renderAt();
    await openMenuItem(/Change guardians/);
    await guardiansSheet().getByRole("button", { name: "Unlink Diego Souza" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => network.post.mock.calls.length).toBe(1);
    // Let the refused POST settle, so a toast would have rendered by now.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    // Checked once, not polled: a polled absence passes when the toast times out.
    expect(
      page.getByText("Couldn’t link Diego Souza. Try again.").elements(),
    ).toHaveLength(0);
  });

  it("says why a Guardian with Bookings at their Home can't be unlinked", async () => {
    network.patch.mockRejectedValue(httpError(409));
    await renderAt();
    await openMenuItem(/Change guardians/);
    await guardiansSheet().getByRole("button", { name: "Unlink Laura Souza" }).click();
    await expect
      .element(
        guardiansSheet().getByText(
          "Laura Souza can’t be unlinked: Sofia Souza has upcoming Bookings at their Home. Change them to another Location first.",
        ),
      )
      .toBeVisible();
  });

  it("offers Try again when the Guardians fail to load", async () => {
    let calls = 0;
    serve({
      "/api/clients": () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(httpError(500))
          : Promise.resolve({ data: ACTIVE_GUARDIANS });
      },
    });
    await renderAt();
    await openMenuItem(/Change guardians/);
    const picker = guardiansSheet();
    await expect
      .element(picker.getByText("Couldn’t load Guardians. Check your connection."))
      .toBeVisible();
    await picker.getByRole("button", { name: "Try again" }).click();
    await expect
      .element(picker.getByRole("combobox", { name: "Guardian" }))
      .toBeVisible();
  });
});

describe("archive", () => {
  it("confirms with the upcoming count, sends it and toasts", async () => {
    network.post.mockImplementation(() => {
      child = { ...child, archived: true };
      return Promise.resolve({
        data: {
          type: "child",
          id: "c-1",
          archived: true,
          cancelled_booking_ids: ["b-1", "b-2", "b-3"],
          archived_child_ids: [],
        },
      });
    });
    await renderAt();
    await openMenuItem(/Archive/);
    const confirm = page.getByRole("alertdialog", { name: "Archive Sofia Souza?" });
    await expect
      .element(
        confirm.getByText(
          "Their 3 upcoming Bookings are cancelled, and Restore won’t bring them back.",
        ),
      )
      .toBeVisible();
    await confirm.getByRole("button", { name: "Archive child" }).click();

    await expect
      .element(
        page.getByText("Sofia Souza archived. 3 upcoming Bookings were cancelled."),
      )
      .toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/archive", {
      type: "child",
      id: "c-1",
      expected_cancellations: 3,
    });
    await expect.element(overlay().getByText("Archived").first()).toBeVisible();
    await expect
      .element(overlay().getByRole("button", { name: "Book evaluation" }))
      .not.toBeInTheDocument();
  });

  it("says they can't be booked when nothing is upcoming", async () => {
    child = { ...SOFIA, upcoming_session_count: 0, next_session: null };
    await renderAt();
    await openMenuItem(/Archive/);
    await expect
      .element(page.getByText("They can’t be booked until restored."))
      .toBeVisible();
  });

  it("reopens the confirm with the new count after a 409", async () => {
    let calls = 0;
    network.post.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        child = { ...child, upcoming_session_count: 4 };
        return Promise.reject(httpError(409));
      }
      return Promise.resolve({
        data: {
          type: "child",
          id: "c-1",
          archived: true,
          cancelled_booking_ids: [],
          archived_child_ids: [],
        },
      });
    });
    await renderAt();
    await openMenuItem(/Archive/);
    await page.getByRole("button", { name: "Archive child" }).click();
    await expect
      .element(
        page.getByText(
          "Their 4 upcoming Bookings are cancelled, and Restore won’t bring them back.",
        ),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Archive child" }).click();
    await expect.poll(() => network.post.mock.calls.at(-1)?.[1]).toEqual({
      type: "child",
      id: "c-1",
      expected_cancellations: 4,
    });
  });

  it("toasts when the archive fails", async () => {
    network.post.mockRejectedValue(httpError(500));
    await renderAt();
    await openMenuItem(/Archive/);
    await page.getByRole("button", { name: "Archive child" }).click();
    await expect
      .element(page.getByText("Couldn’t archive Sofia Souza. Try again."))
      .toBeVisible();
  });

  it("restores an archived Child", async () => {
    child = { ...SOFIA, archived: true };
    network.post.mockImplementation(() => {
      child = SOFIA;
      return Promise.resolve({ data: {} });
    });
    await renderAt();
    await openMenuItem(/Restore/);
    await expect
      .element(
        page.getByText("Sofia Souza restored. Cancelled Bookings stay cancelled."),
      )
      .toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/restore", {
      type: "child",
      id: "c-1",
    });
    await expect
      .element(overlay().getByRole("button", { name: "Book evaluation" }))
      .toBeVisible();
  });
});
