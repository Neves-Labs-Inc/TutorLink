import { queryOptions } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
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

const confirmDialog = () => page.getByRole("alertdialog");

// POST /api/archive and /api/restore move the Subject between the lists.
function stubArchiveActs(): void {
  network.post.mockImplementation(async (url: string, data: { id: string }) => {
    if (url === "/api/archive") {
      const found = active.find((item) => item.id === data.id);
      active = active.filter((item) => item.id !== data.id);
      archived = [...archived, { ...found!, archived: true }];
    } else if (url === "/api/restore") {
      const found = archived.find((item) => item.id === data.id);
      archived = archived.filter((item) => item.id !== data.id);
      active = [...active, { ...found!, archived: false }];
    }
    return { data: {} };
  });
}

describe("archiving a Subject", () => {
  it("offers Archive on an active Subject and Restore on an archived one, never both", async () => {
    archived = [subject({ id: "s-9", name: "Latin", archived: true })];
    await renderSubjects();

    await row("Math").click();
    await expect
      .element(sheet().getByRole("button", { name: "Archive" }))
      .toBeVisible();
    expect(
      sheet().getByRole("button", { name: "Restore" }).elements(),
    ).toHaveLength(0);
    await sheet().getByRole("button", { name: "Cancel" }).click();
    await expect.element(sheet()).not.toBeInTheDocument();

    await group().getByRole("button", { name: "Archived" }).click();
    await row("Latin").click();
    await expect
      .element(sheet().getByRole("button", { name: "Restore" }))
      .toBeVisible();
    expect(
      sheet().getByRole("button", { name: "Archive" }).elements(),
    ).toHaveLength(0);
  });

  it("asks first, naming the stored name and the tutor count", async () => {
    await renderSubjects();

    await row("Math").click();
    await sheet().getByRole("textbox", { name: /^Name/ }).fill("Draft name");
    await sheet().getByRole("button", { name: "Archive" }).click();

    await expect
      .element(confirmDialog().getByRole("heading", { name: "Archive Math?" }))
      .toBeVisible();
    await expect
      .element(confirmDialog())
      .toHaveTextContent(
        "3 tutors teach it. The bot stops offering it and it can’t be picked for new Bookings or levels. Upcoming Bookings stay.",
      );
    await expect
      .element(confirmDialog().getByRole("button", { name: "Archive subject" }))
      .toBeVisible();
    expect(network.post).not.toHaveBeenCalled();
  });

  it("archives, toasts, moves the row to Archived and focuses the tab", async () => {
    await renderSubjects();
    stubArchiveActs();

    await row("Math").click();
    await sheet().getByRole("button", { name: "Archive" }).click();
    await confirmDialog()
      .getByRole("button", { name: "Archive subject" })
      .click();

    await expect.element(page.getByText("Math archived.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/archive", {
      type: "subject",
      id: "s-1",
    });
    await expect.element(sheet()).not.toBeInTheDocument();
    expect(row("Math").elements()).toHaveLength(0);
    await expect.element(row("Art")).toBeVisible();
    await expect
      .element(group().getByRole("button", { name: "Active" }))
      .toHaveFocus();
    await group().getByRole("button", { name: "Archived" }).click();
    await expect.element(row("Math")).toBeVisible();
  });

  it("closes only the dialog on Keep subject", async () => {
    await renderSubjects();

    await row("Math").click();
    await sheet().getByRole("textbox", { name: /^Name/ }).fill("Maths");
    await sheet().getByRole("button", { name: "Archive" }).click();
    await confirmDialog().getByRole("button", { name: "Keep subject" }).click();

    await expect.element(confirmDialog()).not.toBeInTheDocument();
    await expect.element(sheet()).toBeVisible();
    await expect
      .element(sheet().getByRole("textbox", { name: /^Name/ }))
      .toHaveValue("Maths");
    expect(network.post).not.toHaveBeenCalled();
  });

  it("shows a failure in the dialog, keeps it open, and retries", async () => {
    await renderSubjects();
    stubArchiveActs();
    network.post.mockRejectedValueOnce(new Error("offline"));

    await row("Math").click();
    await sheet().getByRole("button", { name: "Archive" }).click();
    await confirmDialog()
      .getByRole("button", { name: "Archive subject" })
      .click();

    await expect
      .element(
        confirmDialog().getByText(
          "Couldn’t archive Math. Check your connection and try again.",
        ),
      )
      .toBeVisible();
    await confirmDialog()
      .getByRole("button", { name: "Archive subject" })
      .click();
    await expect.element(page.getByText("Math archived.")).toBeVisible();
  });

  it("ignores Escape while the archive is in flight", async () => {
    await renderSubjects();
    let finish: () => void = () => {};
    network.post.mockImplementation(
      () => new Promise((resolve) => (finish = () => resolve({ data: {} }))),
    );

    await row("Math").click();
    await sheet().getByRole("button", { name: "Archive" }).click();
    await confirmDialog()
      .getByRole("button", { name: "Archive subject" })
      .click();
    await userEvent.keyboard("{Escape}");

    await expect.element(confirmDialog()).toBeVisible();
    await expect
      .element(confirmDialog().getByRole("button", { name: "Keep subject" }))
      .toBeDisabled();
    finish();
    await expect.element(page.getByText("Math archived.")).toBeVisible();
  });

  it("steps back a page when archiving empties the last one", async () => {
    active = Array.from({ length: 21 }, (_, index) =>
      subject({
        id: `s-${index}`,
        name: `Subject ${String(index).padStart(2, "0")}`,
      }),
    );
    await renderSubjects();
    stubArchiveActs();

    await page.getByRole("button", { name: /next/i }).click();
    await row("Subject 20").click();
    await sheet().getByRole("button", { name: "Archive" }).click();
    await confirmDialog()
      .getByRole("button", { name: "Archive subject" })
      .click();

    await expect.element(page.getByText("Subject 20 archived.")).toBeVisible();
    await expect.element(row("Subject 00")).toBeVisible();
  });
});

describe("restoring a Subject", () => {
  it("restores at once, toasts, and moves the row to Active", async () => {
    archived = [subject({ id: "s-9", name: "Latin", archived: true })];
    await renderSubjects();
    stubArchiveActs();

    await group().getByRole("button", { name: "Archived" }).click();
    await row("Latin").click();
    await sheet().getByRole("button", { name: "Restore" }).click();

    await expect.element(page.getByText("Latin restored.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/restore", {
      type: "subject",
      id: "s-9",
    });
    await expect.element(sheet()).not.toBeInTheDocument();
    await expect
      .element(group().getByText("No archived subjects"))
      .toBeVisible();
    await expect
      .element(group().getByRole("button", { name: "Archived" }))
      .toHaveFocus();
  });

  it("shows a form alert on failure and keeps the sheet and its values", async () => {
    archived = [subject({ id: "s-9", name: "Latin", archived: true })];
    await renderSubjects();
    network.post.mockRejectedValue(new Error("offline"));

    await group().getByRole("button", { name: "Archived" }).click();
    await row("Latin").click();
    await sheet().getByRole("textbox", { name: /^Name/ }).fill("Latina");
    await sheet().getByRole("button", { name: "Restore" }).click();

    await expect
      .element(sheet().getByRole("alert"))
      .toHaveTextContent("Couldn’t restore Latin.");
    await expect
      .element(sheet().getByRole("textbox", { name: /^Name/ }))
      .toHaveValue("Latina");
    await expect
      .element(sheet().getByRole("button", { name: "Restore" }))
      .toBeEnabled();
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
