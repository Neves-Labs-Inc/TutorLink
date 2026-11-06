import { queryOptions } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import AppLayout from "@/components/layout/app-layout";
import type { Subject } from "@/lib/queries/subjects";
import SettingsPage from "@/pages/settings/settings-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";
import { settleLayout } from "@/test/settleLayout";

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 800 };

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, post: network.post, patch: network.patch },
}));

vi.mock("@/lib/queries/settings", () => ({
  settingQueries: {
    page: () =>
      queryOptions({
        queryKey: ["settings", "list"],
        queryFn: network.getSettings,
      }),
  },
  updateSettings: vi.fn(),
  sendTestEmail: vi.fn(),
}));

function subject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: "s-1",
    name: "Math",
    name_es: "Matemáticas",
    description: "Numbers",
    archived: false,
    tutor_count: 3,
    ...overrides,
  };
}

function pageOf(items: Subject[], total = items.length, pageNumber = 1) {
  return { items, total, page: pageNumber, page_size: 20 };
}

function failure(status: number, detail: string): AxiosError {
  return new AxiosError("Failed", "ERR_BAD_REQUEST", undefined, undefined, {
    status,
    statusText: "Failed",
    data: { detail },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

const SETTINGS = {
  items: [
    {
      key: "session_length_minutes",
      value: "50",
      value_type: "string",
      is_developer_only: false,
    },
  ],
  total: 1,
  page: 1,
  page_size: 100,
  business_timezone_locked: true,
  reminders_paused: false,
};

// Admin Subjects lists by tab; PATCH and POST answer per test.
let active: Subject[];
let archived: Subject[];

async function renderSubjects(): Promise<void> {
  useAuthStore.setState({ status: "authenticated", role: "admin" });
  await renderWithProviders(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await expect
    .element(page.getByRole("region", { name: "Subjects", exact: true }))
    .toBeVisible();
  await settleLayout();
}

const group = () => page.getByRole("region", { name: "Subjects" });
// At this width the list is tappable rows, whose button name starts with the
// Subject's name; the table's "Open <name>" button is hidden.
const row = (name: string) =>
  group().getByRole("button", { name: new RegExp(`^${name}`) });
const sheet = () => page.getByRole("dialog");
const saveBar = () => page.getByRole("region", { name: "Unsaved changes" });

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  active = [subject(), subject({ id: "s-2", name: "Art", name_es: null })];
  archived = [];
  network.get.mockReset();
  network.get.mockImplementation(
    async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === "/api/subjects") {
        const params = config?.params ?? {};
        const items = params.archived ? archived : active;
        const start = ((Number(params.page) || 1) - 1) * 20;
        return {
          data: pageOf(
            items.slice(start, start + 20),
            items.length,
            Number(params.page) || 1,
          ),
        };
      }
      return { data: {} };
    },
  );
  network.post.mockReset();
  network.patch.mockReset();
  network.getSettings.mockReset();
  network.getSettings.mockResolvedValue(SETTINGS);
});

describe("the Subjects group", () => {
  it("sits after Office in the page and lists Active Subjects", async () => {
    await renderSubjects();

    const headings = page
      .getByRole("main")
      .getByRole("heading", { level: 2 })
      .elements()
      .map((heading) => heading.textContent ?? "");
    const office = headings.findIndex((text) => text.startsWith("Office"));
    expect(headings[office + 1]).toMatch(/^Subjects/);
    await expect.element(row("Math")).toBeVisible();
    await expect.element(row("Math")).toHaveTextContent("Spanish: Matemáticas");
    await expect.element(row("Math")).toHaveTextContent("3 tutors");
    await expect
      .element(row("Art"))
      .toHaveTextContent("Spanish: English name used");
    expect(
      page.getByRole("navigation", { name: "Subject pages" }).elements(),
    ).toHaveLength(0);
  });

  it("lists Archived Subjects on the other tab", async () => {
    archived = [subject({ id: "s-9", name: "Latin", archived: true })];
    await renderSubjects();

    await group().getByRole("button", { name: "Archived" }).click();

    await expect.element(row("Latin")).toBeVisible();
    expect(row("Math").elements()).toHaveLength(0);
  });

  it("explains an empty Active and an empty Archived tab", async () => {
    active = [];
    await renderSubjects();
    await expect.element(group().getByText("No subjects yet")).toBeVisible();

    await group().getByRole("button", { name: "Archived" }).click();
    await expect
      .element(group().getByText("No archived subjects"))
      .toBeVisible();
  });

  it("shows the Pager only past 20 Subjects", async () => {
    active = Array.from({ length: 21 }, (_, index) =>
      subject({ id: `s-${index}`, name: `Subject ${index}` }),
    );
    await renderSubjects();

    await expect
      .element(page.getByRole("navigation", { name: "Subject pages" }))
      .toBeVisible();
  });

  it("shows an error inside the group and retries, leaving Settings working", async () => {
    network.get.mockImplementation(async (url: string) => {
      if (url === "/api/subjects") throw new Error("offline");
      return { data: {} };
    });
    await renderSubjects();

    await expect
      .element(
        group().getByText("Couldn’t load Subjects. Check your connection."),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Booking rules" }))
      .toBeVisible();

    network.get.mockImplementation(async (url: string) => ({
      data: url === "/api/subjects" ? pageOf(active) : {},
    }));
    await group().getByRole("button", { name: "Try again" }).click();
    await expect.element(row("Math")).toBeVisible();
  });
});

describe("adding a Subject", () => {
  it("creates it, toasts, and shows it in Active", async () => {
    await renderSubjects();
    network.post.mockImplementation(async (_url, data) => {
      active = [...active, subject({ id: "s-3", ...data, tutor_count: 0 })];
      return { data: active[active.length - 1] };
    });

    await group().getByRole("button", { name: "Add subject" }).click();
    await expect
      .element(sheet().getByRole("heading", { name: "Add subject" }))
      .toBeVisible();
    await sheet().getByRole("textbox", { name: /^Name/ }).fill("Chess");
    await sheet().getByRole("button", { name: "Add subject" }).click();

    await expect.element(page.getByText("Subject added.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/subjects", {
      name: "Chess",
      name_es: null,
      description: null,
    });
    await expect.element(row("Chess")).toBeVisible();
  });

  it("asks for a name on a blank submit and sends nothing", async () => {
    await renderSubjects();

    await group().getByRole("button", { name: "Add subject" }).click();
    await sheet().getByRole("button", { name: "Add subject" }).click();

    await expect.element(sheet().getByText("Enter a name.")).toBeVisible();
    expect(network.post).not.toHaveBeenCalled();
  });

  it("shows a duplicate name under Name and keeps the sheet open", async () => {
    await renderSubjects();
    network.post.mockRejectedValue(failure(409, "Subject already exists"));

    await group().getByRole("button", { name: "Add subject" }).click();
    await sheet().getByRole("textbox", { name: /^Name/ }).fill("Math");
    await sheet().getByRole("button", { name: "Add subject" }).click();

    await expect
      .element(sheet().getByText("A subject with that name already exists"))
      .toBeVisible();
    await expect.element(sheet()).toBeVisible();
  });

  it("shows a field 400 under its field with the label", async () => {
    await renderSubjects();
    network.post.mockRejectedValue(
      failure(400, "name_es: String should have at most 100 characters"),
    );

    await group().getByRole("button", { name: "Add subject" }).click();
    await sheet().getByRole("textbox", { name: /^Name/ }).fill("Chess");
    await sheet().getByRole("button", { name: "Add subject" }).click();

    await expect
      .element(
        sheet().getByText(
          "Spanish name: String should have at most 100 characters",
        ),
      )
      .toBeVisible();
  });

  it("shows a form alert for any other failure and keeps the values", async () => {
    await renderSubjects();
    network.post.mockRejectedValue(new Error("offline"));

    await group().getByRole("button", { name: "Add subject" }).click();
    await sheet().getByRole("textbox", { name: /^Name/ }).fill("Chess");
    await sheet().getByRole("button", { name: "Add subject" }).click();

    await expect
      .element(
        sheet().getByText(
          "Couldn’t add this Subject. Check your connection and try again.",
        ),
      )
      .toBeVisible();
    await expect
      .element(sheet().getByRole("textbox", { name: /^Name/ }))
      .toHaveValue("Chess");
  });
});

describe("editing a Subject", () => {
  it("prefills, saves a blank Spanish name as null, and toasts", async () => {
    await renderSubjects();
    network.patch.mockImplementation(async (_url, data) => {
      active = [subject({ ...data }), active[1]];
      return { data: active[0] };
    });

    await row("Math").click();
    await expect
      .element(sheet().getByRole("heading", { name: "Edit subject" }))
      .toBeVisible();
    await expect
      .element(sheet().getByRole("textbox", { name: /^Name/ }))
      .toHaveValue("Math");
    await expect
      .element(sheet().getByRole("textbox", { name: "Spanish name" }))
      .toHaveValue("Matemáticas");
    await sheet().getByRole("textbox", { name: "Spanish name" }).clear();
    await sheet().getByRole("textbox", { name: /^Name/ }).fill("Maths");
    await sheet().getByRole("button", { name: "Save" }).click();

    await expect.element(page.getByText("Subject saved.")).toBeVisible();
    expect(network.patch).toHaveBeenCalledWith("/api/subjects/s-1", {
      name: "Maths",
      name_es: null,
      description: "Numbers",
    });
    await expect.element(row("Maths")).toBeVisible();
  });

  it("never touches the Save bar", async () => {
    await renderSubjects();
    network.patch.mockResolvedValue({ data: subject() });

    await row("Math").click();
    await sheet().getByRole("textbox", { name: /^Name/ }).fill("Maths");
    await expect.element(saveBar()).not.toBeInTheDocument();
    await sheet().getByRole("button", { name: "Save" }).click();

    await expect.element(page.getByText("Subject saved.")).toBeVisible();
    await expect.element(saveBar()).not.toBeInTheDocument();
  });
});

describe("on a phone", () => {
  it("has no horizontal scroll and lists tappable rows", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await renderSubjects();

    await expect.element(row("Math")).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      PHONE.width,
    );
    await expect
      .element(group().getByRole("button", { name: "Add subject" }))
      .toBeVisible();
  });
});
