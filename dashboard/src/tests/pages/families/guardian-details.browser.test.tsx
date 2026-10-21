import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  GuardianRemindersRead,
  HomeRead,
  HouseholdRead,
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
  children: [
    { id: "c-1", name: "Sofia Souza", grade_level: 5, archived: false },
    { id: "c-2", name: "Mateo Souza", grade_level: null, archived: true },
    { id: "c-3", name: "Lucas Souza", grade_level: 2, archived: false },
  ],
  homes: [],
  next_booking: null,
};

function makeChild(
  id: string,
  name: string,
  archived: boolean,
  upcoming: number,
): ChildDetail {
  return {
    id,
    name,
    date_of_birth: "2016-04-02",
    grade_level: 5,
    school_name: "Lincoln Elementary",
    notes: null,
    archived,
    upcoming_session_count: upcoming,
    next_session: null,
    guardians: [],
    homes: [],
    levels: [],
    evaluated: null,
    assigned_tutors: [],
    evaluation_run_by: null,
  };
}

function makeHome(overrides: Partial<HomeRead>): HomeRead {
  return {
    id: "h-1",
    label: "Dad’s",
    address: "1200 Brickell Ave, Miami",
    directions: "Gate code 4411.",
    archived: false,
    guardians: [{ id: "g-1", name: "Laura Souza" }],
    upcoming_booking_count: 0,
    ...overrides,
  };
}

const LAURA: ClientRead = {
  id: "g-1",
  name: "Laura Souza",
  phone_number: "+13055550100",
  archived: false,
  homes: [
    makeHome({}),
    makeHome({
      id: "h-2",
      label: null,
      address: "8 Coral Way",
      directions: null,
      guardians: [
        { id: "g-1", name: "Laura Souza" },
        { id: "g-2", name: "Diego Souza" },
      ],
    }),
    makeHome({ id: "h-3", label: "Old flat", archived: true }),
  ],
  children: [
    { ...childRef("c-1", "Sofia Souza", false), grade_level: 5 },
    { ...childRef("c-2", "Mateo Souza", true), grade_level: null },
  ],
  language: null,
  language_conversation_id: null,
  reminders: "opt_in",
  reminders_blocked_by_whatsapp: false,
};

function childRef(id: string, name: string, archived: boolean) {
  return {
    id,
    name,
    date_of_birth: null,
    grade_level: null,
    school_name: "",
    notes: null,
    archived,
    evaluated: null,
  };
}

const REMINDERS: GuardianRemindersRead = {
  consent: {
    state: "opt_in",
    source: "staff",
    set_at: "2026-10-12T15:00:00-04:00",
    blocked_by_whatsapp: false,
  },
  last_reminder: {
    week_start: "2026-10-12",
    status: "delivered",
    error_code: null,
    skip_reason: null,
  },
  history: [
    {
      id: "r-2",
      action: "opt_in",
      source: "staff",
      created_at: "2026-10-12T15:00:00-04:00",
      who: "Ana Brooks",
    },
    {
      id: "r-1",
      action: "opt_out",
      source: "system",
      created_at: "2026-09-03T10:00:00-04:00",
      who: "WhatsApp",
    },
  ],
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

// Child details' footer opens the Bookings form through this.
const BOOKING_OVERLAYS: BookingOverlays = {
  openBooking: () => {},
  openNewBooking: () => {},
  openChangeBooking: () => {},
};

const ok = (data: unknown) => () => Promise.resolve({ data });

let guardian: ClientRead = LAURA;
let responses: Responses = {};

function serve(overrides: Responses = {}): void {
  responses = {
    "/api/households/g-1": ok(HOUSEHOLD),
    "/api/children/c-1": ok(makeChild("c-1", "Sofia Souza", false, 2)),
    "/api/children/c-2": ok(makeChild("c-2", "Mateo Souza", true, 0)),
    "/api/children/c-3": ok(makeChild("c-3", "Lucas Souza", false, 1)),
    "/api/clients/g-1": () => Promise.resolve({ data: guardian }),
    "/api/clients/g-1/reminders": ok(REMINDERS),
    ...overrides,
  };
}

function LocationProbe(): ReactNode {
  const location = useLocation();
  return (
    <output aria-label="Location">{`${location.pathname}${location.search}`}</output>
  );
}

function renderAt(path: string, theme: Theme = "light") {
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <BookingOverlaysContext.Provider value={BOOKING_OVERLAYS}>
        <Routes>
          <Route
            path="/families/:memberId"
            element={
              <KitRoot theme={theme} height="640px">
                <FamilyPage />
              </KitRoot>
            }
          />
          <Route path="/chats/:id" element={<p>Chat page</p>} />
        </Routes>
      </BookingOverlaysContext.Provider>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const overlay = () => page.getByRole("dialog", { name: "Laura Souza" });
const location = () => page.getByRole("status", { name: "Location" });

async function openMenuItem(name: string | RegExp): Promise<void> {
  await overlay().getByRole("button", { name: "More actions" }).click();
  await page
    .getByRole("dialog", { name: "Laura Souza" })
    .getByRole("button", { name })
    .last()
    .click();
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  guardian = LAURA;
  network.get.mockReset();
  network.post.mockReset();
  network.patch.mockReset();
  serve();
  network.get.mockImplementation((url: string) => {
    const respond = responses[url];
    return respond ? respond() : Promise.reject(httpError(404));
  });
});

describe("guardian details body", () => {
  it.each(["light", "dark"] as const)(
    "shows the contact, language and reminders rows (%s)",
    async (theme) => {
      await renderAt("/families/g-1?guardian=g-1", theme);
      const details = overlay();
      await expect.element(details.getByText("Reminders on").first()).toBeVisible();
      await expect.element(details.getByText("+1 (305) 555-0100")).toBeVisible();
      await expect.element(details.getByText("English", { exact: true })).toBeVisible();
      await expect
        .element(details.getByText("Not detected yet, so English"))
        .toBeVisible();
      await expect
        .element(details.getByText("WhatsApp is blocking reminders to this number"))
        .not.toBeInTheDocument();
    },
  );

  it("warns when WhatsApp blocks reminders, and shows Spanish once detected", async () => {
    guardian = {
      ...LAURA,
      language: "es",
      reminders: "opt_out",
      reminders_blocked_by_whatsapp: true,
    };
    await renderAt("/families/g-1?guardian=g-1");
    const details = overlay();
    await expect.element(details.getByText("Spanish", { exact: true })).toBeVisible();
    await expect
      .element(details.getByText("Not detected yet, so English"))
      .not.toBeInTheDocument();
    await expect.element(details.getByText("Reminders off").first()).toBeVisible();
    await expect
      .element(details.getByText("WhatsApp is blocking reminders to this number"))
      .toBeVisible();
  });

  it("marks an archived Guardian in the header", async () => {
    guardian = { ...LAURA, archived: true };
    await renderAt("/families/g-1?guardian=g-1");
    await expect.element(overlay().getByText("Archived").first()).toBeVisible();
  });

  it("lists their Children, and a row opens that Child stacked", async () => {
    await renderAt("/families/g-1?guardian=g-1");
    const details = overlay();
    await expect
      .element(details.getByRole("heading", { name: "Children · 2" }))
      .toBeVisible();
    await expect.element(details.getByText("Grade 5")).toBeVisible();
    await expect.element(details.getByText("Grade not set")).toBeVisible();

    await details.getByRole("button", { name: "Open Sofia Souza" }).click();
    await expect
      .element(page.getByRole("dialog", { name: "Sofia Souza" }))
      .toBeVisible();
    await expect.element(location()).toHaveTextContent("/families/g-1?child=c-1");
  });

  it("says Child for one and No Children yet for none", async () => {
    guardian = { ...LAURA, children: [] };
    await renderAt("/families/g-1?guardian=g-1");
    await expect.element(overlay().getByText("No Children yet")).toBeVisible();
  });

  it("lists their live Homes read-only, with who they're shared with", async () => {
    await renderAt("/families/g-1?guardian=g-1");
    const details = overlay();
    await expect.element(details.getByRole("heading", { name: "Homes · 2" })).toBeVisible();
    await expect.element(details.getByText("Dad’s")).toBeVisible();
    await expect.element(details.getByText("Gate code 4411.")).toBeVisible();
    await expect.element(details.getByText("Shared with Diego Souza")).toBeVisible();
    await expect.element(details.getByText("Old flat")).not.toBeInTheDocument();
    const homes = details.getByRole("list", { name: "Homes" });
    expect(homes.getByRole("button").elements()).toHaveLength(0);
    expect(homes.getByRole("link").elements()).toHaveLength(0);
  });

  it("says No Homes yet when they have none", async () => {
    guardian = { ...LAURA, homes: [] };
    await renderAt("/families/g-1?guardian=g-1");
    await expect.element(overlay().getByText("No Homes yet.")).toBeVisible();
  });

  it("has no Open chat without a chat", async () => {
    await renderAt("/families/g-1?guardian=g-1");
    await expect.element(overlay().getByText("+1 (305) 555-0100")).toBeVisible();
    await expect
      .element(overlay().getByRole("button", { name: "Open chat" }))
      .not.toBeInTheDocument();
  });

  it.each([
    [1280, 800],
    [375, 740],
  ])("opens their chat at %ipx", async (width, height) => {
    await page.viewport(width, height);
    guardian = { ...LAURA, language_conversation_id: "conv-9" };
    await renderAt("/families/g-1?guardian=g-1", "dark");
    await overlay().getByRole("button", { name: "Open chat" }).click();
    await expect.element(page.getByText("Chat page")).toBeVisible();
    await expect.element(location()).toHaveTextContent("/chats/conv-9");
  });
});

const sheet = (name: string) => page.getByRole("dialog", { name });

function routePosts(routes: Record<string, (body: unknown) => Promise<unknown>>) {
  network.post.mockImplementation((url: string, body: unknown) => {
    const respond = routes[url];
    return respond ? respond(body) : Promise.reject(httpError(404));
  });
}

describe("edit guardian", () => {
  it("saves a changed name and number, then toasts", async () => {
    network.patch.mockImplementation((_url: string, changes: Partial<ClientRead>) => {
      guardian = { ...guardian, ...changes };
      return Promise.resolve({ data: guardian });
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Edit Guardian/);
    const edit = sheet("Edit Guardian");
    await expect
      .element(edit.getByRole("combobox", { name: "Guardian language" }))
      .toBeDisabled();
    await expect
      .element(
        edit.getByText("Detected when they first message the bot. Until then, English."),
      )
      .toBeVisible();

    await edit.getByRole("textbox", { name: "Name" }).fill("Laura Souza Lima");
    await edit.getByRole("textbox", { name: "WhatsApp number" }).fill("+13055550199");
    await edit.getByRole("button", { name: "Save guardian" }).click();

    await expect.element(page.getByText("Guardian saved.")).toBeVisible();
    await expect.element(sheet("Edit Guardian")).not.toBeInTheDocument();
    expect(network.patch).toHaveBeenCalledWith("/api/clients/g-1", {
      name: "Laura Souza Lima",
      phone_number: "+13055550199",
    });
    await expect
      .element(page.getByRole("dialog", { name: "Laura Souza Lima" }))
      .toBeVisible();
  });

  it("asks for a name", async () => {
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Edit Guardian/);
    const edit = sheet("Edit Guardian");
    await edit.getByRole("textbox", { name: "Name" }).fill("  ");
    await edit.getByRole("button", { name: "Save guardian" }).click();
    await expect.element(edit.getByText("Enter the Guardian’s name.")).toBeVisible();
    expect(network.patch).not.toHaveBeenCalled();
  });

  it.each([
    [409, "A client with that phone number already exists", "Another Guardian already has this number."],
    [409, "That number's WhatsApp chat belongs to another Guardian", "That number’s WhatsApp chat belongs to another Guardian."],
    [400, "phone_number is not a phone number that can be dialled", "Enter a WhatsApp number the bot can reach, with country code."],
    [500, "boom", "Couldn’t save. Check your connection and try again."],
  ])("words a %i (%s)", async (status, detail, message) => {
    network.patch.mockRejectedValue(httpError(status, detail));
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Edit Guardian/);
    const edit = sheet("Edit Guardian");
    await edit.getByRole("textbox", { name: "WhatsApp number" }).fill("+13055550199");
    await edit.getByRole("button", { name: "Save guardian" }).click();
    await expect.element(edit.getByText(message)).toBeVisible();
    await expect.element(page.getByText("Guardian saved.")).not.toBeInTheDocument();
  });

  it("changes the Guardian language on their chat", async () => {
    guardian = { ...LAURA, language: "en", language_conversation_id: "conv-9" };
    network.patch.mockResolvedValue({ data: {} });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Edit Guardian/);
    const edit = sheet("Edit Guardian");
    await expect
      .element(edit.getByText("Every message to them uses it, Booking reminders included."))
      .toBeVisible();
    await edit.getByRole("combobox", { name: "Guardian language" }).click();
    await page.getByRole("option", { name: "Spanish" }).click();
    await edit.getByRole("button", { name: "Save guardian" }).click();

    await expect.element(page.getByText("Guardian saved.")).toBeVisible();
    expect(network.patch).toHaveBeenCalledTimes(1);
    expect(network.patch).toHaveBeenCalledWith("/api/conversations/conv-9", {
      language: "es",
    });
  });

  it("says when the name saved but the language didn't", async () => {
    guardian = { ...LAURA, language: "en", language_conversation_id: "conv-9" };
    network.patch.mockImplementation((url: string) =>
      url.startsWith("/api/clients")
        ? Promise.resolve({ data: guardian })
        : Promise.reject(httpError(500)),
    );
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Edit Guardian/);
    const edit = sheet("Edit Guardian");
    await edit.getByRole("textbox", { name: "Name" }).fill("Laura Lima");
    await edit.getByRole("combobox", { name: "Guardian language" }).click();
    await page.getByRole("option", { name: "Spanish" }).click();
    await edit.getByRole("button", { name: "Save guardian" }).click();
    await expect
      .element(
        edit.getByText("Saved the name and number, but not the language. Try again."),
      )
      .toBeVisible();
  });
});

describe("booking reminders sheet", () => {
  it("shows the last reminder and the history, newest first", async () => {
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Booking reminders/);
    const reminders = sheet("Booking reminders");
    await expect.element(reminders.getByText("Last reminder Oct 12")).toBeVisible();
    await expect
      .element(reminders.getByText("This records what they told you. The Guardian gets no message."))
      .toBeVisible();
    const rows = reminders.getByRole("listitem").elements();
    expect(rows.map((row) => row.textContent)).toEqual([
      "Oct 12, 2026Reminders onby Ana Brooks",
      "Sep 3, 2026Reminders offby WhatsApp",
    ]);
  });

  it("records the other choice in place, with no toast", async () => {
    routePosts({
      "/api/clients/g-1/reminders/consent": () => {
        guardian = { ...guardian, reminders: "opt_out" };
        return Promise.resolve({
          data: {
            ...REMINDERS,
            consent: { ...REMINDERS.consent, state: "opt_out" },
            history: [
              {
                id: "r-3",
                action: "opt_out",
                source: "staff",
                created_at: "2026-10-20T09:00:00-04:00",
                who: "Ana Brooks",
              },
              ...REMINDERS.history,
            ],
          },
        });
      },
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Booking reminders/);
    const reminders = sheet("Booking reminders");
    await reminders.getByRole("button", { name: "Record Reminders off" }).click();

    await expect
      .element(reminders.getByRole("button", { name: "Record Reminders on" }))
      .toBeVisible();
    await expect.element(reminders.getByText("Oct 20, 2026")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith(
      "/api/clients/g-1/reminders/consent",
      { action: "opt_out" },
    );
    // Toasts are the kit's only status regions with text.
    const toasts = [...document.querySelectorAll("[data-kit] [role=status]")];
    expect(toasts.filter((toast) => toast.textContent)).toHaveLength(0);

    await reminders.getByRole("button", { name: "Done" }).click();
    await expect.element(sheet("Booking reminders")).not.toBeInTheDocument();
    await expect.element(overlay().getByText("Reminders off").first()).toBeVisible();
  });

  it("hides recording while WhatsApp blocks them", async () => {
    guardian = { ...LAURA, reminders: "opt_out", reminders_blocked_by_whatsapp: true };
    serve({
      "/api/clients/g-1/reminders": ok({
        ...REMINDERS,
        consent: { ...REMINDERS.consent, state: "opt_out", blocked_by_whatsapp: true },
      }),
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Booking reminders/);
    const reminders = sheet("Booking reminders");
    await expect
      .element(
        reminders.getByRole("note").getByText(
          "They turned reminders off in WhatsApp. Only they can turn them back on, by messaging START.",
        ),
      )
      .toBeVisible();
    await expect
      .element(reminders.getByRole("button", { name: /Record/ }))
      .not.toBeInTheDocument();
  });

  it("shows the block when recording is refused", async () => {
    guardian = { ...LAURA, reminders: "opt_out" };
    serve({
      "/api/clients/g-1/reminders": ok({
        ...REMINDERS,
        consent: { ...REMINDERS.consent, state: "opt_out" },
      }),
    });
    routePosts({
      "/api/clients/g-1/reminders/consent": () => Promise.reject(httpError(409)),
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Booking reminders/);
    const reminders = sheet("Booking reminders");
    await reminders.getByRole("button", { name: "Record Reminders on" }).click();
    await expect.element(reminders.getByRole("note")).toBeVisible();
    await expect
      .element(reminders.getByRole("button", { name: /Record/ }))
      .not.toBeInTheDocument();
  });

  it("says when recording fails for another reason", async () => {
    routePosts({
      "/api/clients/g-1/reminders/consent": () => Promise.reject(httpError(500)),
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Booking reminders/);
    const reminders = sheet("Booking reminders");
    await reminders.getByRole("button", { name: "Record Reminders off" }).click();
    await expect
      .element(reminders.getByText("Couldn’t record that. Check your connection and try again."))
      .toBeVisible();
  });

  it("says when nothing is recorded or sent yet", async () => {
    serve({
      "/api/clients/g-1/reminders": ok({ ...REMINDERS, last_reminder: null, history: [] }),
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Booking reminders/);
    const reminders = sheet("Booking reminders");
    await expect.element(reminders.getByText("No reminder sent yet")).toBeVisible();
    await expect.element(reminders.getByText("No choices recorded yet")).toBeVisible();
  });

  it("shows the history loading, then a retry when it fails", async () => {
    let respond: (() => void) | null = null;
    serve({
      "/api/clients/g-1/reminders": () =>
        new Promise((_resolve, reject) => {
          respond = () => reject(httpError(500));
        }),
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Booking reminders/);
    const reminders = sheet("Booking reminders");
    await expect
      .element(reminders.getByRole("status", { name: "Loading reminders history" }))
      .toBeVisible();
    await expect.poll(() => respond).not.toBeNull();
    respond!();
    await expect
      .element(reminders.getByText("Couldn’t load reminders history. Check your connection."))
      .toBeVisible();
    await expect
      .element(reminders.getByRole("button", { name: "Record Reminders off" }))
      .toBeVisible();
  });
});

describe("archive and restore", () => {
  const LAST_GUARDIAN: HouseholdRead = { ...HOUSEHOLD };
  const WITH_DIEGO: HouseholdRead = {
    ...HOUSEHOLD,
    guardians: HOUSEHOLD.guardians.map((member) => ({ ...member, archived: false })),
  };

  it("says only that they lose the bot while another Guardian is active", async () => {
    serve({ "/api/households/g-1": ok(WITH_DIEGO) });
    routePosts({
      "/api/archive": () => {
        guardian = { ...guardian, archived: true };
        return Promise.resolve({
          data: {
            type: "guardian",
            id: "g-1",
            archived: true,
            cancelled_booking_ids: [],
            archived_child_ids: [],
          },
        });
      },
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Archive/);
    const confirm = page.getByRole("alertdialog", { name: "Archive Laura Souza?" });
    await expect.element(confirm.getByText("They can no longer use the bot.")).toBeVisible();
    await expect.element(confirm.getByText(/last active Guardian/)).not.toBeInTheDocument();

    await confirm.getByRole("button", { name: "Archive guardian" }).click();
    await expect.element(page.getByText("Laura Souza archived.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/archive", {
      type: "guardian",
      id: "g-1",
      expected_cancellations: 0,
    });
    await expect.element(overlay().getByText("Archived").first()).toBeVisible();
  });

  it("names the Children and Bookings the cascade takes, and sends the count", async () => {
    serve({ "/api/households/g-1": ok(LAST_GUARDIAN) });
    routePosts({
      "/api/archive": () =>
        Promise.resolve({
          data: {
            type: "guardian",
            id: "g-1",
            archived: true,
            cancelled_booking_ids: ["b-1", "b-2", "b-3"],
            archived_child_ids: ["c-1", "c-3"],
          },
        }),
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Archive/);
    const confirm = page.getByRole("alertdialog", { name: "Archive Laura Souza?" });
    await expect
      .element(
        confirm.getByText(
          "They’re the family’s last active Guardian, so Sofia Souza and Lucas Souza are archived too and their 3 upcoming Bookings are cancelled. Restore won’t bring those back.",
        ),
      )
      .toBeVisible();
    await confirm.getByRole("button", { name: "Archive guardian" }).click();

    await expect
      .element(
        page.getByText(
          "Laura Souza archived. Sofia Souza and Lucas Souza archived and 3 Bookings cancelled.",
        ),
      )
      .toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/archive", {
      type: "guardian",
      id: "g-1",
      expected_cancellations: 3,
    });
  });

  it("recounts and asks again when the Bookings changed", async () => {
    let sofiaUpcoming = 2;
    serve({
      "/api/households/g-1": ok(LAST_GUARDIAN),
      "/api/children/c-1": () =>
        Promise.resolve({ data: makeChild("c-1", "Sofia Souza", false, sofiaUpcoming) }),
    });
    routePosts({
      "/api/archive": (body) => {
        const { expected_cancellations: expected } = body as {
          expected_cancellations: number;
        };
        return expected === 5
          ? Promise.resolve({
              data: {
                type: "guardian",
                id: "g-1",
                archived: true,
                cancelled_booking_ids: [],
                archived_child_ids: [],
              },
            })
          : Promise.reject(httpError(409));
      },
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Archive/);
    const confirm = page.getByRole("alertdialog", { name: "Archive Laura Souza?" });
    await expect.element(confirm.getByText(/their 3 upcoming Bookings/)).toBeVisible();

    sofiaUpcoming = 4;
    await confirm.getByRole("button", { name: "Archive guardian" }).click();
    await expect.element(confirm.getByText(/their 5 upcoming Bookings/)).toBeVisible();
    await confirm.getByRole("button", { name: "Archive guardian" }).click();
    await expect.element(page.getByText("Laura Souza archived.")).toBeVisible();
    expect(network.post).toHaveBeenLastCalledWith("/api/archive", {
      type: "guardian",
      id: "g-1",
      expected_cancellations: 5,
    });
  });

  it("toasts when the archive fails", async () => {
    serve({ "/api/households/g-1": ok(WITH_DIEGO) });
    routePosts({ "/api/archive": () => Promise.reject(httpError(500)) });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Archive/);
    await page
      .getByRole("alertdialog", { name: "Archive Laura Souza?" })
      .getByRole("button", { name: "Archive guardian" })
      .click();
    await expect.element(page.getByText("Couldn’t archive Laura Souza. Try again.")).toBeVisible();
  });

  it("restores, and says their Children stay archived", async () => {
    guardian = { ...LAURA, archived: true };
    routePosts({
      "/api/restore": () => {
        guardian = { ...guardian, archived: false };
        return Promise.resolve({
          data: {
            type: "guardian",
            id: "g-1",
            archived: false,
            cancelled_booking_ids: [],
            archived_child_ids: [],
          },
        });
      },
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Restore/);
    await expect
      .element(
        page.getByText(
          "Laura Souza restored. Their Children stay archived until you restore them.",
        ),
      )
      .toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/restore", {
      type: "guardian",
      id: "g-1",
    });
  });

  it("restores with a plain toast when none of their Children is archived", async () => {
    guardian = { ...LAURA, archived: true, children: [LAURA.children[0]] };
    routePosts({
      "/api/restore": () => Promise.resolve({ data: {} }),
    });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Restore/);
    await expect.element(page.getByText("Laura Souza restored.", { exact: true })).toBeVisible();
  });

  it("toasts when the restore fails", async () => {
    guardian = { ...LAURA, archived: true };
    routePosts({ "/api/restore": () => Promise.reject(httpError(500)) });
    await renderAt("/families/g-1?guardian=g-1");
    await openMenuItem(/Restore/);
    await expect.element(page.getByText("Couldn’t restore Laura Souza. Try again.")).toBeVisible();
  });
});
