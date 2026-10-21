import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import AvailabilityPage from "@/pages/availability/availability-page";
import type { AvailabilitySlot } from "@/lib/queries/availability";
import type { Page } from "@/lib/queries/page";
import { renderWithProviders } from "@/test/render-with-providers";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 800 };

const ME = {
  id: "u-7",
  email: "marco@example.com",
  role: "tutor",
  name: "Marco Rossi",
  tutor_id: "t-7",
  office_phone: "+15125550100",
  welcome_seen: true,
};

const MONDAY: AvailabilitySlot = {
  id: "s-1",
  tutor_id: "t-7",
  day_of_week: 0,
  start_time: "15:00:00",
  end_time: "18:00:00",
  is_active: true,
  mode: "traveler",
};

function pageOf(items: AvailabilitySlot[]): Page<AvailabilitySlot> {
  return { items, total: items.length, page: 1, page_size: 100 };
}

const network = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, put: network.put },
}));

type Responses = {
  week?: (requestedPage: number) => Promise<unknown>;
};

function respond({
  week = async () => pageOf([MONDAY]),
}: Responses = {}): void {
  network.get.mockImplementation(
    async (url: string, config?: { params: { page: number } }) => {
      const body =
        url === "/api/me" ? ME : await week(config?.params.page ?? 1);
      return { data: body };
    },
  );
}

// 100 retired Monday rows fill the first page; the active Sunday range
// is row 101, on page 2.
const RETIRED_ROWS = 100;
const SUNDAY: AvailabilitySlot = { ...MONDAY, id: "s-sun", day_of_week: 6 };
function longHistoryWeek(requestedPage: number): Promise<Page<AvailabilitySlot>> {
  const retired = Array.from({ length: RETIRED_ROWS }, (_, index) => ({
    ...MONDAY,
    id: `old-${index}`,
    is_active: false,
  }));
  const items = requestedPage === 1 ? retired : [SUNDAY];
  return Promise.resolve({
    items,
    total: RETIRED_ROWS + 1,
    page: requestedPage,
    page_size: 100,
  });
}

function never(): Promise<never> {
  return new Promise(() => {});
}

async function renderPage(): Promise<void> {
  await renderWithProviders(
    <KitRoot theme="light">
      <AvailabilityPage />
    </KitRoot>,
  );
}

const editButton = () => page.getByRole("button", { name: "Edit" });
const saveButton = () => page.getByRole("button", { name: "Save" });

describe.each([
  ["desktop", DESKTOP],
  ["phone", PHONE],
])("My availability on %s", (_label, size) => {
  beforeEach(async () => {
    await page.viewport(size.width, size.height);
    network.get.mockReset();
    network.put.mockReset();
    respond();
  });

  it("heads the page and reads this Tutor's week", async () => {
    await renderPage();
    await expect
      .element(page.getByRole("heading", { name: "My availability", level: 1 }))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          "When and where the bot can offer you to Guardians. Time off overrides it.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByText("3:00 PM – 6:00 PM")).toBeVisible();
    expect(network.get).toHaveBeenCalledWith("/api/tutors/t-7/availability", {
      params: { page: 1, page_size: 100 },
    });
  });

  it("shows a 7-day skeleton while the week loads", async () => {
    respond({ week: never });
    await renderPage();
    const skeleton = page.getByRole("status", { name: "Loading availability" });
    await expect.element(skeleton).toBeVisible();
    const days = skeleton.element().querySelectorAll("[data-skeleton-day]");
    expect(days).toHaveLength(7);
  });

  it("offers Try again when the week fails to load", async () => {
    let attempts = 0;
    respond({
      week: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("500");
        return pageOf([MONDAY]);
      },
    });
    await renderPage();
    await expect
      .element(
        page.getByText(
          "Couldn’t load the availability. Check your connection and try again.",
        ),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(page.getByText("3:00 PM – 6:00 PM")).toBeVisible();
  });

  it("notes an empty week in the Tutor's own words", async () => {
    respond({ week: async () => pageOf([]) });
    await renderPage();
    await expect
      .element(
        page.getByText(
          "You have no availability yet, so the bot can’t offer you to Guardians. Tap Edit to add the times you can teach.",
        ),
      )
      .toBeVisible();
    expect(page.getByText("Not available").elements()).toHaveLength(7);
  });

  it("reads every page, so a slot past row 100 is shown and kept on Save", async () => {
    respond({ week: longHistoryWeek });
    network.put.mockResolvedValue({ data: pageOf([SUNDAY]) });
    await renderPage();
    await expect.element(page.getByText("3:00 PM – 6:00 PM")).toBeVisible();
    expect(network.get).toHaveBeenCalledWith("/api/tutors/t-7/availability", {
      params: { page: 2, page_size: 100 },
    });

    await editButton().click();
    await saveButton().click();
    await expect
      .element(page.getByText("Availability saved. The bot offers the new times now."))
      .toBeVisible();
    expect(network.put).toHaveBeenCalledWith("/api/tutors/t-7/availability", {
      slots: [
        {
          day_of_week: 6,
          start_time: "15:00:00",
          end_time: "18:00:00",
          mode: "traveler",
        },
      ],
    });
  });

  it("hides inactive slots", async () => {
    respond({
      week: async () => pageOf([{ ...MONDAY, is_active: false }]),
    });
    await renderPage();
    await expect.element(page.getByText("No time ranges yet")).toBeVisible();
  });

  it("saves the whole week through PUT and says so", async () => {
    const saved = { ...MONDAY, end_time: "19:00:00" };
    network.put.mockResolvedValue({ data: pageOf([saved]) });
    await renderPage();
    await editButton().click();
    await page.getByLabelText("Monday range 1 ends").fill("19:00");
    await saveButton().click();

    await expect
      .element(
        page.getByText("Availability saved. The bot offers the new times now."),
      )
      .toBeVisible();
    await expect.element(page.getByText("3:00 PM – 7:00 PM")).toBeVisible();
    expect(network.put).toHaveBeenCalledWith("/api/tutors/t-7/availability", {
      slots: [
        {
          day_of_week: 0,
          start_time: "15:00:00",
          end_time: "19:00:00",
          mode: "traveler",
        },
      ],
    });
  });

  it("keeps the edits and shows the alert when the save fails", async () => {
    network.put.mockRejectedValue(new Error("500"));
    await renderPage();
    await editButton().click();
    await page.getByLabelText("Monday range 1 ends").fill("19:00");
    await saveButton().click();

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent(
        "Couldn’t save the availability. Check your connection and try again.",
      );
    await expect
      .element(page.getByLabelText("Monday range 1 ends"))
      .toHaveValue("19:00");
  });
});
