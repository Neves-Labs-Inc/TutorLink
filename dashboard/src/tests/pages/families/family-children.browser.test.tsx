import { AxiosError, AxiosHeaders } from "axios";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import FamilyPage from "@/pages/families/family-page";
import { useAuthStore } from "@/stores/authStore";
import {
  bookingOverlaysSpy,
  renderWithProviders,
} from "@/test/render-with-providers";
import type {
  ChildDetail,
  ClientRead,
  HouseholdChild,
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

function makeHouseholdChild(id: string, name: string, archived = false): HouseholdChild {
  return { id, name, grade_level: 5, archived };
}

function makeHousehold(
  children: HouseholdChild[],
  guardianCount = 2,
): HouseholdRead {
  const guardians = [
    { id: "g-1", name: "Laura Souza", phone_number: "+13055550100", archived: false },
    { id: "g-2", name: "Diego Souza", phone_number: "+13055550101", archived: false },
  ].slice(0, guardianCount);
  return {
    key: "g-1",
    name: "Laura & Diego Souza",
    archived: false,
    guardians,
    children,
    homes: [
      {
        id: "h-1",
        label: null,
        address: "1200 Brickell Ave",
        directions: null,
        archived: false,
        guardian_ids: ["g-1"],
      },
    ],
    next_booking: null,
  };
}

function makeChild(id: string, name: string, overrides: Partial<ChildDetail> = {}): ChildDetail {
  return {
    id,
    name,
    date_of_birth: "2016-04-02",
    grade_level: 5,
    school_name: "Lincoln Elementary",
    notes: null,
    archived: false,
    upcoming_session_count: 0,
    next_session: null,
    guardians: [],
    homes: [],
    levels: [],
    evaluated: null,
    assigned_tutors: [],
    evaluation_run_by: null,
    ...overrides,
  };
}

const SOFIA = makeChild("c-1", "Sofia Souza", {
  levels: [
    { subject_id: "s-1", name: "Math", archived: false, level: 5, set_by: { id: "u", name: "Ana" }, updated_at: "2026-10-01T10:00:00" },
    { subject_id: "s-2", name: "Reading", archived: false, level: 4, set_by: { id: "u", name: "Ana" }, updated_at: "2026-10-01T10:00:00" },
  ],
  evaluated: { at: "2026-09-01T10:00:00", by: { id: "u", name: "Ana Brooks" } },
  assigned_tutors: [
    { id: "t-1", name: "Ana Brooks", role: "tutor" },
    { id: "t-2", name: "Marco Diaz", role: "tutor" },
  ],
  next_session: {
    id: "b-1",
    scheduled_date: "2026-10-15",
    start_time: "15:30:00",
    end_time: "16:30:00",
    tutor: { id: "t-1", name: "Ana Brooks" },
    subject: { id: "s-1", name: "Math" },
  },
});
const MATEO = makeChild("c-2", "Mateo Souza", {
  grade_level: null,
  evaluated: { at: "2026-09-01T10:00:00", by: { id: "u", name: "Ana Brooks" } },
});

const LAURA: ClientRead = {
  id: "g-1",
  name: "Laura Souza",
  phone_number: "+13055550100",
  archived: false,
  homes: [],
  children: [],
  language: null,
  language_conversation_id: null,
  reminders: "opt_in",
  reminders_blocked_by_whatsapp: false,
};
const DIEGO: ClientRead = { ...LAURA, id: "g-2", name: "Diego Souza" };

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(String(status), "ERR_BAD_REQUEST", config, null, {
    status,
    statusText: String(status),
    headers: {},
    config,
    data: {},
  });
}

type Responses = Record<string, () => Promise<unknown>>;
const ok = (data: unknown) => () => Promise.resolve({ data });

function serve(household: HouseholdRead, children: ChildDetail[], extra: Responses = {}): void {
  const responses: Responses = {
    "/api/households/g-1": ok(household),
    "/api/clients/g-1": ok(LAURA),
    "/api/clients/g-2": ok(DIEGO),
    ...Object.fromEntries(children.map((child) => [`/api/children/${child.id}`, ok(child)])),
    ...extra,
  };
  network.get.mockImplementation((url: string) => {
    const respond = responses[url];
    return respond ? respond() : Promise.reject(httpError(404));
  });
}

function Location(): ReactNode {
  const location = useLocation();
  return <output aria-label="Location">{`${location.pathname}${location.search}`}</output>;
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

const children = () => page.getByRole("region", { name: /^Children/ });
const card = (name: string) => children().getByRole("button", { name: `Open ${name}` });
const sheet = () => page.getByRole("dialog", { name: "Add child" });

const BOTH = [
  makeHouseholdChild("c-1", "Sofia Souza"),
  makeHouseholdChild("c-2", "Mateo Souza"),
];

beforeEach(async () => {
  await page.viewport(1280, 900);
  for (const method of Object.values(network)) method.mockReset();
  vi.mocked(bookingOverlaysSpy.openNewBooking).mockReset();
  useAuthStore.setState({ status: "authenticated", role: "admin" });
  serve(makeHousehold(BOTH), [SOFIA, MATEO]);
});

describe("Header", () => {
  it("shows the live counts and opens New booking without a prefill for 2 Children", async () => {
    await renderFamily();
    await expect.element(page.getByRole("heading", { name: "Laura & Diego Souza" })).toBeVisible();
    await expect.element(page.getByText("2 Children · 2 Guardians · 1 Home")).toBeVisible();
    await page.getByRole("button", { name: "New booking" }).first().click();
    expect(bookingOverlaysSpy.openNewBooking).toHaveBeenCalledWith({});
  });

  it("prefills the only live Child", async () => {
    serve(
      makeHousehold([makeHouseholdChild("c-1", "Sofia Souza"), makeHouseholdChild("c-2", "Mateo Souza", true)]),
      [SOFIA, { ...MATEO, archived: true }],
    );
    await renderFamily();
    await expect.element(page.getByText("1 Child · 2 Guardians · 1 Home")).toBeVisible();
    await page.getByRole("button", { name: "New booking" }).first().click();
    expect(bookingOverlaysSpy.openNewBooking).toHaveBeenCalledWith({ childId: "c-1" });
  });
});

describe("Child cards", () => {
  it("shows grade, levels, Assigned Tutors and the next booking", async () => {
    await renderFamily();
    await expect.element(children().getByRole("heading", { name: "Children · 2 live" })).toBeVisible();
    const sofia = card("Sofia Souza");
    await expect.element(sofia).toHaveTextContent("Grade 5 · Lincoln Elementary");
    await expect.element(sofia).toHaveTextContent("Math Grade 5 · Reading Grade 4");
    await expect.element(sofia).toHaveTextContent("Assigned Tutors: Ana Brooks, Marco Diaz");
    await expect.element(sofia).toHaveTextContent("Thu, Oct 15, 3:30 PM · Ana");
  });

  it("flags an Evaluated Child with no Tutor and says when nothing is set", async () => {
    await renderFamily();
    const mateo = card("Mateo Souza");
    await expect.element(mateo).toHaveTextContent("Needs a Tutor");
    await expect.element(mateo).toHaveTextContent("Grade not set · Lincoln Elementary");
    await expect.element(mateo).toHaveTextContent("No Subject levels yet");
    await expect.element(mateo).toHaveTextContent("Nothing booked");
  });

  it("shows nothing Tutor-related before Evaluated", async () => {
    serve(makeHousehold(BOTH), [SOFIA, { ...MATEO, evaluated: null }]);
    await renderFamily();
    await expect.element(card("Mateo Souza")).toHaveTextContent("Nothing booked");
    await expect.element(card("Mateo Souza")).not.toHaveTextContent("Needs a Tutor");
    await expect.element(card("Mateo Souza")).not.toHaveTextContent("Assigned Tutors");
  });

  it("opens the Child's details", async () => {
    await renderFamily();
    await card("Sofia Souza").click();
    await expect
      .element(page.getByRole("status", { name: "Location" }))
      .toHaveTextContent("/families/g-1?child=c-1");
  });

  it("mutes an archived Child and drops its Tutors line", async () => {
    serve(
      makeHousehold([makeHouseholdChild("c-1", "Sofia Souza", true)]),
      [{ ...SOFIA, archived: true }],
    );
    await renderFamily();
    const sofia = card("Sofia Souza");
    await expect.element(sofia).toHaveTextContent("Archived");
    await expect.element(sofia).toHaveClass("text-(--tl-muted)");
    await expect.element(sofia).not.toHaveTextContent("Assigned Tutors");
    await expect.element(sofia).toHaveTextContent("Thu, Oct 15");
  });

  it("colours the first four Children with a dot and the fifth none", async () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => makeHouseholdChild(id, `Kid ${id}`));
    serve(makeHousehold(five), five.map((child) => makeChild(child.id, child.name)));
    await renderFamily();
    await expect.element(card("Kid a")).toBeVisible();
    const dots = (name: string) => card(name).element().querySelectorAll(".size-2\\.5");
    await expect.poll(() => dots("Kid d").length).toBe(1);
    expect(dots("Kid e").length).toBe(0);
  });

  it("has no dot for a lone Child", async () => {
    serve(makeHousehold([BOTH[0]]), [SOFIA]);
    await renderFamily();
    await expect.element(card("Sofia Souza")).toBeVisible();
    expect(card("Sofia Souza").element().querySelectorAll(".size-2\\.5").length).toBe(0);
  });

  it("fails one card without the others", async () => {
    serve(makeHousehold(BOTH), [SOFIA], {
      "/api/children/c-2": () => Promise.reject(httpError(500)),
    });
    await renderFamily();
    await expect.element(card("Sofia Souza")).toBeVisible();
    await expect
      .element(children().getByText("Couldn’t load Mateo. Check your connection."))
      .toBeVisible();
  });

  it("says when the family has no Children", async () => {
    serve(makeHousehold([]), []);
    await renderFamily();
    await expect.element(children().getByText("No Children yet")).toBeVisible();
  });
});

describe("Add child", () => {
  async function openSheet() {
    await renderFamily();
    await children().getByRole("button", { name: "Add child" }).click();
    return sheet();
  }

  it("is hidden when no Guardian is live", async () => {
    serve(makeHousehold(BOTH, 0), [SOFIA, MATEO]);
    await renderFamily();
    await expect.element(card("Sofia Souza")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Add child" })).not.toBeInTheDocument();
  });

  it("checks the required fields on submit, then on blur", async () => {
    const add = await openSheet();
    await add.getByRole("button", { name: "Add child" }).click();
    await expect.element(add.getByText("Enter the Child’s name.")).toBeVisible();
    await expect.element(add.getByText("Enter their date of birth.")).toBeVisible();
    expect(network.post).not.toHaveBeenCalled();

    await add.getByRole("textbox", { name: "Name" }).fill("Luca");
    await add.getByRole("textbox", { name: "School" }).click();
    await expect.element(add.getByText("Enter the Child’s name.")).not.toBeInTheDocument();
  });

  it("asks for a Guardian when none is ticked", async () => {
    const add = await openSheet();
    await add.getByRole("checkbox", { name: "Laura Souza" }).click();
    await add.getByRole("checkbox", { name: "Diego Souza" }).click();
    await add.getByRole("button", { name: "Add child" }).click();
    await expect.element(add.getByText("Pick at least one Guardian.")).toBeVisible();
  });

  it("posts the ticked Guardians, toasts and shows the new card", async () => {
    network.post.mockResolvedValue({ data: { id: "c-3", name: "Luca Souza" } });
    const add = await openSheet();
    await expect.element(add.getByRole("checkbox", { name: "Laura Souza" })).toBeChecked();
    await add.getByRole("textbox", { name: "Name" }).fill("Luca Souza");
    await add.getByLabelText("Date of birth").fill("2018-03-04");
    await add.getByRole("textbox", { name: "School" }).fill("Doral Academy");
    await add.getByRole("checkbox", { name: "Diego Souza" }).click();
    // The refetch after the write returns the new Child.
    serve(
      makeHousehold([...BOTH, makeHouseholdChild("c-3", "Luca Souza")]),
      [SOFIA, MATEO, makeChild("c-3", "Luca Souza")],
    );
    await add.getByRole("button", { name: "Add child" }).click();

    expect(network.post).toHaveBeenCalledWith("/api/children", {
      guardian_ids: ["g-1"],
      name: "Luca Souza",
      date_of_birth: "2018-03-04",
      grade_level: null,
      school_name: "Doral Academy",
      notes: null,
    });
    await expect.element(page.getByText("Luca Souza added to the family.")).toBeVisible();
    await expect.element(card("Luca Souza")).toBeVisible();
    await expect.element(sheet()).not.toBeInTheDocument();
  });

  it("keeps the sheet open with a failure line when the API fails", async () => {
    network.post.mockRejectedValue(httpError(500));
    const add = await openSheet();
    await add.getByRole("textbox", { name: "Name" }).fill("Luca");
    await add.getByLabelText("Date of birth").fill("2018-03-04");
    await add.getByRole("button", { name: "Add child" }).click();
    await expect
      .element(add.getByRole("alert").getByText("Couldn’t add Luca. Check your connection and try again."))
      .toBeVisible();
    await expect.element(sheet()).toBeVisible();
  });

  it("leaves Belongs to out with a single live Guardian but still sends it", async () => {
    serve(makeHousehold(BOTH, 1), [SOFIA, MATEO]);
    network.post.mockResolvedValue({ data: { id: "c-3", name: "Luca" } });
    const add = await openSheet();
    await expect.element(add.getByText("Belongs to")).not.toBeInTheDocument();
    await add.getByRole("textbox", { name: "Name" }).fill("Luca");
    await add.getByLabelText("Date of birth").fill("2018-03-04");
    await add.getByRole("button", { name: "Add child" }).click();
    await expect.poll(() => network.post.mock.calls.length).toBe(1);
    expect(network.post.mock.calls[0][1]).toMatchObject({ guardian_ids: ["g-1"] });
  });

  it.each([
    [375, 740],
    [1280, 900],
  ])("brings the failure line into view at %ix%i", async (width, height) => {
    await page.viewport(width, height);
    network.post.mockRejectedValue(httpError(500));
    const add = await openSheet();
    await add.getByRole("textbox", { name: "Name" }).fill("Luca");
    await add.getByLabelText("Date of birth").fill("2018-03-04");
    await add.getByRole("button", { name: "Add child" }).click();
    const alert = add.getByRole("alert").getByText(/Couldn’t add Luca/);
    await expect.element(alert).toBeVisible();
    await expect
      .poll(() => {
        const box = alert.element().getBoundingClientRect();
        const footer = add
          .getByRole("button", { name: "Cancel" })
          .element()
          .getBoundingClientRect();
        return box.top >= 0 && box.bottom <= footer.top && box.bottom <= height;
      })
      .toBe(true);
  });
});
