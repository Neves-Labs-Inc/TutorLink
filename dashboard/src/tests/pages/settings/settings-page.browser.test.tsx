import { queryOptions } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import AppLayout from "@/components/layout/app-layout";
import type { Role } from "@/lib/auth/auth";
import type { SettingsPage as SettingsWire } from "@/lib/queries/settings";
import type { Setting } from "@/lib/settings/settings";
import SettingsPage from "@/pages/settings/settings-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";
import { settleLayout } from "@/test/settleLayout";

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 800 };
const NARROW_PHONE = { width: 320, height: 640 };
const TAB_BAR_CLEARANCE = 92;

const network = vi.hoisted(() => ({
  get: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));

vi.mock("@/lib/queries/settings", () => ({
  settingQueries: {
    page: () =>
      queryOptions({
        queryKey: ["settings", "list"],
        queryFn: network.getSettings,
      }),
  },
  updateSettings: network.updateSettings,
}));

const ME = { id: "u-1", email: "rita@example.com", role: "admin", name: "Rita Souza" };

function row(key: string, value: string, isDeveloperOnly = false): Setting {
  return { key, value, value_type: "string", is_developer_only: isDeveloperOnly };
}

const ADMIN_ROWS = [
  row("session_length_minutes", "50"),
  row("session_gap_minutes", "10"),
  row("booking_lookahead_days", "14"),
  row("min_booking_lead_hours", "0"),
  row("cancellation_cutoff_hours", "24"),
  row("max_slots_offered", "5"),
  row("office_phone", "+13055550142"),
  row("office_address", ""),
  row("default_phone_country_code", "1"),
  row("business_timezone", "America/New_York"),
  row("email_invite_subject", "Welcome"),
  row("email_invite_body", "Open {link}"),
  row("email_invite_brand_color", "#74C8C9"),
  row("chat_retention_days", "365"),
];
const DEVELOPER_ROWS = [
  ...ADMIN_ROWS,
  row("reminder_template_sid_en", "HXabc", true),
  row("reminder_template_sid_es", "", true),
];

function wire(items: Setting[]): SettingsWire {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 100,
    business_timezone_locked: true,
    reminders_paused: false,
  };
}

function never(): Promise<never> {
  return new Promise(() => {});
}

function badRequest(detail: string): AxiosError {
  return new AxiosError("Bad Request", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 400,
    statusText: "Bad Request",
    data: { detail },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

function HomeStub(): ReactNode {
  return <h1>Home page</h1>;
}

async function renderSettings(role: Role = "admin"): Promise<void> {
  useAuthStore.setState({ status: "authenticated", role });
  await renderWithProviders(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/home" element={<HomeStub />} />
          <Route path="*" element={<HomeStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

async function renderLoaded(role: Role = "admin"): Promise<void> {
  await renderSettings(role);
  await expect
    .element(page.getByRole("heading", { name: "Booking rules" }))
    .toBeVisible();
  await settleLayout();
}

const sessionLength = () =>
  page.getByRole("textbox", { name: "Session length", exact: true });
const saveBar = () => page.getByRole("region", { name: "Unsaved changes" });
const saveButton = () => saveBar().getByRole("button", { name: "Save changes" });
const phoneField = () => page.getByRole("textbox", { name: "Office phone" });
const addressField = () => page.getByRole("textbox", { name: "Office address" });

async function retype(field: ReturnType<typeof page.getByRole>, text: string) {
  await field.clear();
  await field.fill(text);
}

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  network.get.mockReset();
  network.get.mockImplementation(async (url: string) => ({
    data: url === "/api/me" ? ME : {},
  }));
  network.getSettings.mockReset();
  network.getSettings.mockResolvedValue(wire(ADMIN_ROWS));
  network.updateSettings.mockReset();
});

describe("who sees what", () => {
  it("shows an Admin Booking rules and Office in words, without raw keys", async () => {
    await renderLoaded("admin");

    for (const label of [
      "Session length",
      "Break between sessions",
      "How far ahead Guardians can book",
      "Minimum notice to book",
      "Last chance to cancel or reschedule",
    ]) {
      await expect
        .element(page.getByRole("group", { name: label, exact: true }))
        .toBeVisible();
      await expect
        .element(page.getByRole("button", { name: `About ${label}` }))
        .toBeVisible();
    }
    await expect
      .element(page.getByRole("button", { name: "About Times offered at once" }))
      .toBeVisible();
    await expect
      .element(page.getByText("The bot offers times up to 2 weeks from today."))
      .toBeVisible();
    await expect
      .element(page.getByText("0 means any time that hasn’t started yet."))
      .toBeVisible();
    await expect.element(phoneField()).toHaveValue("+1 (305) 555-0142");
    await expect.element(page.getByText("Eastern Time (New York)")).toBeVisible();

    const text = document.querySelector("main")?.textContent ?? "";
    expect(text).not.toMatch(/[a-z]+_[a-z_]+/);
    expect(
      page.getByRole("heading", { name: "Developer only" }).elements(),
    ).toHaveLength(0);
  });

  it("gives a Developer the template ids, last, under a Developer badge", async () => {
    network.getSettings.mockResolvedValue(wire(DEVELOPER_ROWS));
    await renderLoaded("developer");
    const group = page.getByRole("region", { name: "Developer only" });

    await expect.element(group.getByText("Developer", { exact: true })).toBeVisible();
    await expect
      .element(group.getByRole("textbox", { name: "Reminder message id, English" }))
      .toHaveValue("HXabc");
    await expect.element(group.getByText("Key: reminder_template_sid_en")).toBeVisible();
    await expect.element(group.getByText("Empty: not approved yet.")).toBeVisible();
    const headings = page
      .getByRole("main")
      .getByRole("heading", { level: 2 })
      .elements()
      .map((heading) => heading.textContent);
    expect(headings.at(-1)).toContain("Developer only");
  });

  it("tells a Manager Settings are for Admins and sends them Home", async () => {
    await renderSettings("manager");
    await expect
      .element(page.getByRole("heading", { name: "Settings are for Admins" }))
      .toBeVisible();
    expect(network.getSettings).not.toHaveBeenCalled();

    await page.getByRole("button", { name: "Go to Home" }).click();
    await expect.element(page.getByRole("heading", { name: "Home page" })).toBeVisible();
  });
});

describe("editing and saving", () => {
  it("tags a change, counts it, and saves only the changed key", async () => {
    network.updateSettings.mockImplementation(async (updates) =>
      wire(
        ADMIN_ROWS.map((item) =>
          item.key === updates[0].key ? { ...item, value: updates[0].value } : item,
        ),
      ),
    );
    await renderLoaded();

    await retype(sessionLength(), "60");
    const group = page.getByRole("group", { name: "Session length", exact: true });
    await expect.element(group.getByText("Changed")).toBeVisible();
    await expect
      .element(
        page
          .getByRole("navigation", { name: "Settings groups" })
          .getByRole("button", { name: /Booking rules.*1 unsaved changes/ }),
      )
      .toBeVisible();
    await expect.element(saveBar()).toHaveTextContent("1 unsaved change");

    await saveButton().click();
    await expect.element(page.getByText("Settings saved.")).toBeVisible();
    expect(network.updateSettings).toHaveBeenCalledTimes(1);
    expect(network.updateSettings.mock.calls[0][0]).toEqual([
      { key: "session_length_minutes", value: "60" },
    ]);
    await expect.element(saveBar()).not.toBeInTheDocument();
    await expect.element(sessionLength()).toHaveValue("60");
    expect(group.getByText("Changed").elements()).toHaveLength(0);
  });

  it("keeps the edits and says so when the save fails", async () => {
    network.updateSettings.mockRejectedValue(new Error("Network Error"));
    await renderLoaded();

    await retype(sessionLength(), "45");
    await saveButton().click();
    await expect
      .element(saveBar())
      .toHaveTextContent("Couldn’t save. Check your connection and try again.");
    await expect.element(sessionLength()).toHaveValue("45");
  });

  it("restores the saved values on Discard", async () => {
    await renderLoaded();

    await retype(sessionLength(), "45");
    await retype(phoneField(), "+15125550100");
    await expect.element(saveBar()).toHaveTextContent("2 unsaved changes");
    await saveBar().getByRole("button", { name: "Discard" }).click();

    await expect.element(sessionLength()).toHaveValue("50");
    await expect.element(phoneField()).toHaveValue("+1 (305) 555-0142");
    await expect.element(saveBar()).not.toBeInTheDocument();
  });

  it("shows a 400 that names a key under that field", async () => {
    network.updateSettings.mockRejectedValue(
      badRequest("office_phone must be a phone number in E.164 form, like +15551234567"),
    );
    await renderLoaded();

    // Passes the client's check; the API's stricter one refuses it.
    await retype(phoneField(), "+15555555555");
    await saveButton().click();
    await expect
      .element(page.getByText("Enter the number with its country code, like +1 305 555 0142."))
      .toBeVisible();
    await expect.element(saveBar()).toHaveTextContent("Fix the highlighted field to save.");
  });
});

describe("checks", () => {
  it("phrases an out-of-range value in the field's units and blocks Save", async () => {
    await renderLoaded();

    await retype(sessionLength(), "0");
    await expect.element(saveBar()).toHaveTextContent("1 unsaved change");
    await phoneField().click();
    await expect
      .element(page.getByText("Enter a length from 1 minute to 1 day."))
      .toBeVisible();
    await expect.element(saveBar()).toHaveTextContent("Fix the highlighted field to save.");
    await expect.element(saveButton()).toBeDisabled();
    expect(network.updateSettings).not.toHaveBeenCalled();
  });

  it("shows the error and sends nothing when Save is tried", async () => {
    await renderLoaded();

    await retype(page.getByRole("textbox", { name: "Times offered at once" }), "x");
    await saveButton().click();
    await expect.element(page.getByText("Enter 1 or more.")).toBeVisible();
    expect(network.updateSettings).not.toHaveBeenCalled();
  });

  it("formats the office phone as typed and saves it as E.164", async () => {
    network.updateSettings.mockResolvedValue(wire(ADMIN_ROWS));
    await renderLoaded();

    await phoneField().clear();
    await userEvent.type(phoneField(), "+15125550100");
    await expect.element(phoneField()).toHaveValue("+1 (512) 555-0100");
    await saveButton().click();

    expect(network.updateSettings.mock.calls[0][0]).toEqual([
      { key: "office_phone", value: "+15125550100" },
    ]);
  });

  it("refuses a phone without its country code", async () => {
    await renderLoaded();

    await retype(phoneField(), "305 555 0142");
    await addressField().click();
    await expect
      .element(page.getByText("Enter the number with its country code, like +1 305 555 0142."))
      .toBeVisible();
  });

  it("counts the address from 400 characters and refuses past 500", async () => {
    await renderLoaded();

    await addressField().fill("a".repeat(399));
    expect(page.getByText("399 / 500").elements()).toHaveLength(0);
    await addressField().fill("a".repeat(400));
    await expect.element(page.getByText("400 / 500")).toBeVisible();

    await addressField().fill("a".repeat(501));
    await phoneField().click();
    await expect.element(page.getByText("501 / 500")).toBeVisible();
    await expect
      .element(page.getByText("Keep the address to 500 characters or fewer."))
      .toBeVisible();
    await expect.element(saveButton()).toBeDisabled();
  });

  it("shows the time zone read-only and never sends it", async () => {
    network.updateSettings.mockResolvedValue(wire(ADMIN_ROWS));
    await renderLoaded();
    const office = page.getByRole("region", { name: "Office" });

    await expect.element(office.getByText("Locked")).toBeVisible();
    expect(office.getByRole("combobox", { name: /Time zone/ }).elements()).toHaveLength(0);
    expect(office.getByRole("textbox", { name: /Time zone/ }).elements()).toHaveLength(0);

    await retype(sessionLength(), "60");
    await saveButton().click();
    const sent = network.updateSettings.mock.calls[0][0] as { key: string }[];
    expect(sent.map((update) => update.key)).not.toContain("business_timezone");
  });
});

describe("load states", () => {
  it("shows three skeleton cards with the header and no jump list", async () => {
    network.getSettings.mockImplementation(never);
    await renderSettings();

    const loading = page.getByRole("status", { name: "Loading settings" });
    await expect.element(loading).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    expect(loading.element().children).toHaveLength(3);
    expect(page.getByRole("navigation", { name: "Settings groups" }).elements()).toHaveLength(0);
  });

  it("offers Try again when Settings fail to load", async () => {
    network.getSettings.mockRejectedValueOnce(new Error("500"));
    await renderSettings();

    await expect
      .element(page.getByRole("heading", { name: "Couldn’t load Settings" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(page.getByRole("heading", { name: "Booking rules" })).toBeVisible();
  });

  it("keeps the error shown, with Try again busy, while it retries", async () => {
    network.getSettings.mockRejectedValueOnce(new Error("500"));
    network.getSettings.mockImplementation(never);
    await renderSettings();

    await page.getByRole("button", { name: "Try again" }).click();
    await expect
      .element(page.getByRole("button", { name: "Trying again…" }))
      .toHaveAttribute("aria-busy", "true");
    await expect
      .element(page.getByRole("heading", { name: "Couldn’t load Settings" }))
      .toBeVisible();
    expect(
      page.getByRole("status", { name: "Loading settings" }).elements(),
    ).toHaveLength(0);
  });

  it("says Settings aren't set up when there are no rows", async () => {
    network.getSettings.mockResolvedValue(wire([]));
    await renderSettings();

    await expect
      .element(page.getByRole("heading", { name: "Settings aren’t set up yet" }))
      .toBeVisible();
    await expect
      .element(page.getByText("Ask your developer to finish setting up TutorLink."))
      .toBeVisible();
  });
});

describe("leave guard", () => {
  const mainNav = () => page.getByRole("navigation", { name: "Main" });
  const leaveDialog = () => page.getByRole("alertdialog", { name: "Leave without saving?" });

  it("asks before leaving with unsaved changes; Keep stays, focus back on the nav", async () => {
    await renderLoaded();
    await retype(sessionLength(), "60");
    const home = mainNav().getByRole("button", { name: "Home" });

    await home.click();
    await expect.element(leaveDialog()).toBeVisible();
    await expect
      .element(leaveDialog())
      .toHaveTextContent(
        "You have 1 unsaved change in Settings. If you leave now, they’re lost.",
      );
    const keep = leaveDialog().getByRole("button", { name: "Keep editing" });
    await expect.element(keep).toHaveFocus();

    await keep.click();
    await expect.element(leaveDialog()).not.toBeInTheDocument();
    await expect.element(home).toHaveFocus();
    await expect.element(sessionLength()).toHaveValue("60");
  });

  it("discards and leaves on Discard changes", async () => {
    await renderLoaded();
    await retype(sessionLength(), "60");

    await mainNav().getByRole("button", { name: "Families" }).click();
    await leaveDialog().getByRole("button", { name: "Discard changes" }).click();
    await expect.element(page.getByRole("heading", { name: "Home page" })).toBeVisible();
    expect(network.updateSettings).not.toHaveBeenCalled();
  });

  it("leaves without asking when nothing changed", async () => {
    await renderLoaded();

    await mainNav().getByRole("button", { name: "Home" }).click();
    await expect.element(page.getByRole("heading", { name: "Home page" })).toBeVisible();
  });

  it("asks the browser to confirm a reload only while dirty", async () => {
    await renderLoaded();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    await retype(sessionLength(), "60");
    await expect.element(saveBar()).toBeVisible();
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);

    await saveBar().getByRole("button", { name: "Discard" }).click();
    await expect.element(saveBar()).not.toBeInTheDocument();
    const discarded = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(discarded);
    expect(discarded.defaultPrevented).toBe(false);
  });
});

describe("layout", () => {
  it("puts Office phone beside Office address and the jump list in a 200px column at 1280px", async () => {
    await renderLoaded();

    const phone = phoneField().element().getBoundingClientRect();
    const address = addressField().element().getBoundingClientRect();
    expect(address.left).toBeGreaterThan(phone.right);
    const column = page
      .getByRole("navigation", { name: "Settings groups" })
      .elements()
      .find((nav) => nav.getBoundingClientRect().width > 0);
    expect(column?.getBoundingClientRect().width).toBe(200);
  });

  it("keeps one column at 1024px so no field gets cramped", async () => {
    await page.viewport(1024, 800);
    await renderLoaded();

    const phone = phoneField().element().getBoundingClientRect();
    const address = addressField().element().getBoundingClientRect();
    expect(address.top).toBeGreaterThan(phone.bottom);
    const scroll = document.querySelector("[data-kit-scroll]");
    expect(scroll?.scrollWidth).toBeLessThanOrEqual(scroll?.clientWidth ?? 0);
  });

  it("floats the Save bar above the phone tab bar", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await renderLoaded();

    await retype(sessionLength(), "60");
    await expect.element(saveBar()).toBeVisible();
    const tabBar = page
      .getByRole("navigation", { name: "Main" })
      .element()
      .getBoundingClientRect();
    // After the bar's rise-in has finished.
    await vi.waitFor(() => {
      const bar = saveBar().element().getBoundingClientRect();
      expect(bar.bottom).toBeLessThanOrEqual(PHONE.height - TAB_BAR_CLEARANCE);
      expect(bar.bottom).toBeLessThanOrEqual(tabBar.top);
    });
  });

  it("has no sideways scroll at 320px", async () => {
    await page.viewport(NARROW_PHONE.width, NARROW_PHONE.height);
    await renderLoaded();

    const scroll = document.querySelector("[data-kit-scroll]");
    expect(scroll?.scrollWidth).toBeLessThanOrEqual(NARROW_PHONE.width);
  });
});
