import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import { RouteGuard } from "@/components/layout/RouteGuard";
import { OFFICE_ROLES } from "@/lib/auth/auth";
import FamiliesPage from "@/pages/families/families-page";
import FamilyPage from "@/pages/families/family-page";
import { useFamilyDetails } from "@/pages/families/hooks/use-family-details";
import LegacyRedirect from "@/pages/families/legacy-redirect";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";
import type { ChildDetail, ClientRead, HouseholdRead } from "@/types/families";

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));

const HOUSEHOLD: HouseholdRead = {
  key: "g-1",
  name: "Laura & Diego Souza",
  archived: false,
  guardians: [
    { id: "g-1", name: "Laura Souza", phone_number: "+15550001", archived: false },
  ],
  children: [
    { id: "c-1", name: "Sofia Souza", grade_level: 5, archived: false },
    { id: "c-2", name: "Tomás Souza", grade_level: 2, archived: true },
  ],
  homes: [],
  next_booking: null,
};

function makeChild(id: string, name: string, archived: boolean): ChildDetail {
  return {
    id,
    name,
    date_of_birth: "2016-04-02",
    grade_level: 5,
    school_name: "Lincoln Elementary",
    notes: null,
    archived,
    upcoming_session_count: 0,
    next_session: null,
    guardians: [],
    homes: [],
    levels: [],
    evaluated: null,
    assigned_tutors: [],
    evaluation_run_by: null,
  };
}

const LAURA: ClientRead = {
  id: "g-1",
  name: "Laura Souza",
  phone_number: "+15550001",
  archived: false,
  homes: [],
  children: [],
  language: null,
  language_conversation_id: null,
  reminders: "never",
  reminders_blocked_by_whatsapp: false,
};

function httpError(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(String(status), "ERR_BAD_REQUEST", config, null, {
    status,
    statusText: String(status),
    headers: {},
    config,
    data: { detail: "Family not found" },
  });
}

type Responses = Record<string, () => Promise<unknown>>;

function serve(responses: Responses): void {
  network.get.mockImplementation((url: string) => {
    const respond = responses[url];
    return respond ? respond() : Promise.reject(httpError(404));
  });
}

const ok = (data: unknown) => () => Promise.resolve({ data });
const never = () => new Promise(() => {});

const FAMILY_RESPONSES: Responses = {
  "/api/households/g-1": ok(HOUSEHOLD),
  "/api/households/c-1": ok(HOUSEHOLD),
  "/api/households/c-2": ok(HOUSEHOLD),
  "/api/children/c-1": ok(makeChild("c-1", "Sofia Souza", false)),
  "/api/children/c-2": ok(makeChild("c-2", "Tomás Souza", true)),
  "/api/clients/g-1": ok(LAURA),
};

// Lives outside KitRoot, so it stays clickable while overlays make the
// page inert: it stands in for ticket 06's Guardian link and the
// browser's own Back.
function TestControls(): ReactNode {
  const location = useLocation();
  const navigate = useNavigate();
  const { openGuardian } = useFamilyDetails();
  return (
    <div>
      <output aria-label="Location">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => openGuardian("g-1")}>
        Test: open Laura
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Test: browser back
      </button>
    </div>
  );
}

function renderAt(path: string) {
  const shell = (screen: ReactNode) => (
    <>
      <KitRoot theme="light" height="640px">
        <RouteGuard allow={OFFICE_ROLES}>{screen}</RouteGuard>
      </KitRoot>
      <TestControls />
    </>
  );
  return renderWithProviders(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/families" element={shell(<FamiliesPage />)} />
        <Route path="/families/:memberId" element={shell(<FamilyPage />)} />
        <Route path="/children" element={<LegacyRedirect kind="child" />} />
        <Route path="/children/:id" element={<LegacyRedirect kind="child" />} />
        <Route path="/guardians" element={<LegacyRedirect kind="guardian" />} />
        <Route path="/guardians/:id" element={<LegacyRedirect kind="guardian" />} />
        <Route path="/sessions" element={<p>My sessions page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const location = () => page.getByRole("status", { name: "Location" });
const dialog = (name: string) => page.getByRole("dialog", { name });

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  serve(FAMILY_RESPONSES);
  useAuthStore.setState({ status: "authenticated", role: "admin" });
});

describe("family page", () => {
  it("shows the family's name under a link back to Families", async () => {
    await renderAt("/families/g-1");
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Laura & Diego Souza" }))
      .toBeVisible();

    await page.getByRole("button", { name: "Families" }).click();
    await expect.element(page.getByRole("heading", { level: 1, name: "Families" })).toBeVisible();
  });

  it.each(["manager", "developer"] as const)("opens for a %s", async (role) => {
    useAuthStore.setState({ role });
    await renderAt("/families/g-1");
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Laura & Diego Souza" }))
      .toBeVisible();
  });

  it("sends a Tutor to their own landing page", async () => {
    useAuthStore.setState({ role: "tutor" });
    await renderAt("/families/g-1");
    await expect.element(page.getByText("My sessions page")).toBeVisible();
    expect(network.get).not.toHaveBeenCalled();
  });

  it("shows the family's shape while it loads", async () => {
    serve({ "/api/households/g-1": never });
    await renderAt("/families/g-1");
    await expect.element(page.getByRole("status", { name: "Loading family" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Families" })).toBeVisible();
    expect(page.getByText("Loading…").elements()).toHaveLength(0);
  });

  it("says a missing family wasn't found, with the way back", async () => {
    await renderAt("/families/nobody");
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Family not found" }))
      .toBeVisible();
    await expect.element(page.getByText("This link doesn’t match a family.")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Try again" })).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Families" }).click();
    await expect.element(location()).toHaveTextContent("/families");
  });

  it("offers Try again when the family fails to load", async () => {
    let calls = 0;
    serve({
      ...FAMILY_RESPONSES,
      "/api/households/g-1": () => {
        calls += 1;
        return calls === 1 ? Promise.reject(httpError(500)) : Promise.resolve({ data: HOUSEHOLD });
      },
    });
    await renderAt("/families/g-1");
    await expect.element(page.getByText("Couldn’t load this family")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Families" })).toBeVisible();

    await page.getByRole("button", { name: "Try again" }).click();
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Laura & Diego Souza" }))
      .toBeVisible();
  });
});

describe("old URLs", () => {
  it.each([
    ["/children", "/families"],
    ["/guardians", "/families"],
  ])("sends %s to the families list", async (from, to) => {
    await renderAt(from);
    await expect.element(location()).toHaveTextContent(new RegExp(`^${to}$`));
    await expect.element(page.getByRole("heading", { level: 1, name: "Families" })).toBeVisible();
  });

  it("opens an old Child URL as that Child's details on their family", async () => {
    await renderAt("/children/c-1");
    await expect.element(dialog("Sofia Souza")).toBeVisible();
    await expect.element(location()).toHaveTextContent("/families/c-1?child=c-1");
  });

  it("opens an old Guardian URL as that Guardian's details on their family", async () => {
    await renderAt("/guardians/g-1");
    await expect.element(dialog("Laura Souza")).toBeVisible();
    await expect.element(location()).toHaveTextContent("/families/g-1?guardian=g-1");
  });
});

describe("details", () => {
  it("opens the Child named in the link over the family page", async () => {
    await renderAt("/families/g-1?child=c-1");
    await expect.element(dialog("Sofia Souza")).toBeVisible();
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Laura & Diego Souza", includeHidden: true }))
      .toBeInTheDocument();
  });

  it("marks an archived Child", async () => {
    await renderAt("/families/g-1?child=c-2");
    await expect.element(dialog("Tomás Souza").getByText("Archived")).toBeVisible();
  });

  it("stacks a Guardian over the Child, Back pops it and Close clears both", async () => {
    await renderAt("/families/g-1?child=c-1");
    await expect.element(dialog("Sofia Souza")).toBeVisible();

    await page.getByRole("button", { name: "Test: open Laura" }).click();
    await expect.element(dialog("Laura Souza")).toBeVisible();
    await expect.element(location()).toHaveTextContent("/families/g-1?guardian=g-1");

    await page.viewport(375, 740);
    await dialog("Laura Souza").getByRole("button", { name: "Sofia Souza" }).click();
    await expect.element(dialog("Laura Souza")).not.toBeInTheDocument();
    await expect.element(dialog("Sofia Souza")).toBeVisible();
    await expect.element(location()).toHaveTextContent("/families/g-1?child=c-1");

    await page.viewport(1280, 800);
    await page.getByRole("button", { name: "Test: open Laura" }).click();
    await expect.element(dialog("Laura Souza")).toBeVisible();
    await dialog("Laura Souza").getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(location()).toHaveTextContent(/^\/families\/g-1$/);
  });

  it("closes the top overlay on browser back", async () => {
    await renderAt("/families/g-1?child=c-1");
    await expect.element(dialog("Sofia Souza")).toBeVisible();
    await page.getByRole("button", { name: "Test: open Laura" }).click();
    await expect.element(dialog("Laura Souza")).toBeVisible();

    await page.getByRole("button", { name: "Test: browser back" }).click();
    await expect.element(dialog("Laura Souza")).not.toBeInTheDocument();
    await expect.element(dialog("Sofia Souza")).toBeVisible();

    // The deep link sits on the family page, so back closes it too.
    await page.getByRole("button", { name: "Test: browser back" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(location()).toHaveTextContent(/^\/families\/g-1$/);
  });

  it("names the family on the phone's Back for the first record", async () => {
    await page.viewport(375, 740);
    await renderAt("/families/g-1?guardian=g-1");
    await expect
      .element(dialog("Laura Souza").getByRole("button", { name: "Laura & Diego Souza" }))
      .toBeVisible();
  });

  it("says when the record isn't in this family", async () => {
    await renderAt("/families/g-1?child=c-9");
    await expect
      .element(dialog("Child details").getByText("This Child isn’t in this family."))
      .toBeVisible();
  });

  it("shows a skeleton while the record loads", async () => {
    serve({ ...FAMILY_RESPONSES, "/api/clients/g-1": never });
    await renderAt("/families/g-1?guardian=g-1");
    await expect
      .element(dialog("Guardian details").getByRole("status", { name: "Loading Guardian details" }))
      .toBeVisible();
  });

  it("offers Try again when the record fails to load", async () => {
    let calls = 0;
    serve({
      ...FAMILY_RESPONSES,
      "/api/children/c-1": () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(httpError(500))
          : Promise.resolve({ data: makeChild("c-1", "Sofia Souza", false) });
      },
    });
    await renderAt("/families/g-1?child=c-1");
    const overlay = dialog("Child details");
    await expect
      .element(overlay.getByText("Couldn’t load Child details. Check your connection."))
      .toBeVisible();

    await overlay.getByRole("button", { name: "Try again" }).click();
    await expect.element(dialog("Sofia Souza")).toBeVisible();
  });
});
