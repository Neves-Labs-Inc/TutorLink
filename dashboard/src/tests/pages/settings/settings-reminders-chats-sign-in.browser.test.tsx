import { queryOptions } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import AppLayout from "@/components/layout/app-layout";
import type { SettingsPage as SettingsWire } from "@/lib/queries/settings";
import type { Setting, SettingUpdate } from "@/lib/settings/settings";
import SettingsPage from "@/pages/settings/settings-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";
import { settleLayout } from "@/test/settleLayout";

// Tuesday 13 October 2026, 10:30 AM in New York (EDT, UTC-4).
const NOW = new Date("2026-10-13T14:30:00Z");

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
  // The Emails group imports it; these tests never open an email editor.
  sendTestEmail: vi.fn(),
}));

const ME = { id: "u-1", email: "rita@example.com", role: "admin", name: "Rita Souza" };

function row(key: string, value: string): Setting {
  return { key, value, value_type: "string", is_developer_only: false };
}

const RULE_PREFIXES = [
  "login_rate_limit_email",
  "login_rate_limit_ip",
  "forgot_password_rate_limit_email",
  "forgot_password_rate_limit_ip",
];
const RULE_TITLES = [
  "Wrong passwords for one email",
  "Sign-in tries from one network",
  "Password reset emails to one address",
  "Password reset requests from one network",
];

const BASE_ROWS = [
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
  row("reminders_enabled", "true"),
  row("reminder_weekday", "1"),
  row("reminder_hour", "9"),
  row("chat_retention_days", "730"),
  row("retention_purge_hour_utc", "7"),
  ...RULE_PREFIXES.flatMap((prefix) => [
    row(`${prefix}_max_attempts`, "5"),
    row(`${prefix}_window_seconds`, "900"),
  ]),
];

function withRows(...overrides: Setting[]): Setting[] {
  return BASE_ROWS.map(
    (item) => overrides.find((over) => over.key === item.key) ?? item,
  );
}

function wire(items: Setting[], arePaused = false): SettingsWire {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 100,
    business_timezone_locked: true,
    reminders_paused: arePaused,
  };
}

function ChatsStub(): ReactNode {
  return <h1>Chats reminders page</h1>;
}

async function renderLoaded(
  items: Setting[] = BASE_ROWS,
  arePaused = false,
): Promise<void> {
  network.getSettings.mockResolvedValue(wire(items, arePaused));
  network.updateSettings.mockImplementation(async (updates: SettingUpdate[]) =>
    wire(
      items.map(
        (item) => updates.find((update) => update.key === item.key) ?? item,
      ).map((item) => ("value" in item ? { ...row(item.key, item.value) } : item)),
      arePaused,
    ),
  );
  useAuthStore.setState({ status: "authenticated", role: "admin" });
  await renderWithProviders(
    <MemoryRouter initialEntries={["/settings"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/chats/reminders" element={<ChatsStub />} />
          <Route path="*" element={<ChatsStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  await expect
    .element(page.getByRole("heading", { name: "Booking rules" }))
    .toBeVisible();
  await settleLayout();
}

const reminders = () => page.getByRole("region", { name: "Booking reminders" });
const chatHistory = () => page.getByRole("region", { name: "Chat history" });
const signIn = () => page.getByRole("region", { name: "Sign-in protection" });
const signInHead = () =>
  signIn().getByRole("button", { name: /Sign-in protection/ });
const saveBar = () => page.getByRole("region", { name: "Unsaved changes" });
const saveButton = () => saveBar().getByRole("button", { name: "Save changes" });
const confirmDialog = () =>
  page.getByRole("alertdialog", { name: "Delete older chats?" });
const retentionAmount = () =>
  chatHistory().getByRole("textbox", { name: "Delete messages older than" });

async function retype(field: ReturnType<typeof page.getByRole>, text: string) {
  await field.clear();
  await field.fill(text);
}

async function openSignIn(): Promise<void> {
  await signInHead().click();
  await expect.element(signIn().getByText("These apply to everyone")).toBeVisible();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  await page.viewport(1280, 900);
  network.get.mockReset();
  network.get.mockImplementation(async (url: string) => ({
    data: url === "/api/me" ? ME : {},
  }));
  network.getSettings.mockReset();
  network.updateSettings.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Booking reminders", () => {
  it("shows the next send and an On badge while on", async () => {
    await renderLoaded();

    await expect.element(reminders().getByText("On", { exact: true })).toBeVisible();
    await expect
      .element(reminders().getByRole("status"))
      .toHaveTextContent("Next send: Mon, Oct 19 at 9:00 AM EDT");
    await expect
      .element(reminders().getByRole("status"))
      .toHaveTextContent(
        "Only to Guardians with Reminders on and no session booked for the coming week.",
      );
  });

  it("says Today when the day is today and the hour is still ahead", async () => {
    await renderLoaded(
      withRows(row("reminder_weekday", "2"), row("reminder_hour", "15")),
    );

    await expect
      .element(reminders().getByRole("status"))
      .toHaveTextContent("Next send: Today at 3:00 PM EDT");
  });

  it("shows Paused and disables Day and Time while off", async () => {
    await renderLoaded(withRows(row("reminders_enabled", "false")));

    await expect.element(reminders().getByText("Off", { exact: true })).toBeVisible();
    await expect
      .element(reminders().getByRole("status"))
      .toHaveTextContent("Paused for everyone");
    await expect
      .element(reminders().getByRole("combobox", { name: "Day" }))
      .toBeDisabled();
    await expect
      .element(reminders().getByRole("combobox", { name: "Time" }))
      .toBeDisabled();
  });

  it("says Not set up whatever the switch says, and keeps the switch usable", async () => {
    await renderLoaded(BASE_ROWS, true);

    await expect
      .element(reminders().getByText("Not set up", { exact: true }))
      .toBeVisible();
    await expect
      .element(reminders().getByRole("status"))
      .toHaveTextContent("Not set up yet");
    await expect
      .element(reminders().getByRole("switch", { name: "Send Booking reminders" }))
      .toBeEnabled();
  });

  it("counts a change in the Save bar and saves the three reminder keys", async () => {
    await renderLoaded();

    await reminders().getByRole("switch", { name: "Send Booking reminders" }).click();
    await expect.element(saveBar()).toHaveTextContent("1 unsaved change");
    await saveButton().click();
    await expect.element(page.getByText("Settings saved.")).toBeVisible();
    expect(network.updateSettings.mock.calls[0][0]).toEqual([
      { key: "reminders_enabled", value: "false" },
    ]);
  });

  it("sends the picked Day and Time", async () => {
    await renderLoaded();

    await reminders().getByRole("combobox", { name: "Day" }).click();
    await page.getByRole("option", { name: "Friday", exact: true }).click();
    await reminders().getByRole("combobox", { name: "Time" }).click();
    await page.getByRole("option", { name: "6:00 PM", exact: true }).click();
    await saveButton().click();

    await expect.element(page.getByText("Settings saved.")).toBeVisible();
    expect(network.updateSettings.mock.calls[0][0]).toEqual([
      { key: "reminder_weekday", value: "5" },
      { key: "reminder_hour", value: "18" },
    ]);
  });

  it("links to the Chats Reminders tab", async () => {
    await renderLoaded();

    await reminders().getByRole("button", { name: "Chats ▸ Reminders" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Chats reminders page" }))
      .toBeVisible();
  });
});

describe("Chat history", () => {
  it("shows the UTC clean-up hour in office time, with the daylight saving note", async () => {
    await renderLoaded();

    await expect
      .element(chatHistory().getByRole("combobox", { name: "Daily clean-up time" }))
      .toHaveTextContent("3:00 AM");
    await expect
      .element(
        chatHistory().getByText(
          "Office time (EDT). Stored in UTC, so it shifts by an hour when daylight saving changes.",
        ),
      )
      .toBeVisible();
  });

  it("writes a picked 2:00 AM back as 6 UTC", async () => {
    await renderLoaded();

    await chatHistory()
      .getByRole("combobox", { name: "Daily clean-up time" })
      .click();
    await page.getByRole("option", { name: "2:00 AM", exact: true }).click();
    await saveButton().click();

    await expect.element(page.getByText("Settings saved.")).toBeVisible();
    expect(network.updateSettings.mock.calls[0][0]).toEqual([
      { key: "retention_purge_hour_utc", value: "6" },
    ]);
  });

  it("asks before shortening, names the period and clean-up, and saves only on confirm", async () => {
    await renderLoaded();

    await retype(retentionAmount(), "1");
    await saveButton().click();
    await expect.element(confirmDialog()).toBeVisible();
    await expect
      .element(confirmDialog())
      .toHaveTextContent(
        "Messages older than 1 year will be deleted at the next clean-up, tomorrow at 3:00 AM EDT. Chats left empty go too. This can’t be undone.",
      );
    expect(network.updateSettings).not.toHaveBeenCalled();

    await confirmDialog().getByRole("button", { name: "Keep editing" }).click();
    await expect.element(confirmDialog()).not.toBeInTheDocument();
    expect(network.updateSettings).not.toHaveBeenCalled();
    await expect.element(retentionAmount()).toHaveValue("1");

    await saveButton().click();
    await confirmDialog().getByRole("button", { name: "Save and delete" }).click();
    await expect.element(page.getByText("Settings saved.")).toBeVisible();
    expect(network.updateSettings.mock.calls[0][0]).toEqual([
      { key: "chat_retention_days", value: "365" },
    ]);
  });

  it("asks when Forever becomes a set time", async () => {
    await renderLoaded(withRows(row("chat_retention_days", "0")));

    await expect
      .element(
        chatHistory().getByText(
          "Clean-up still runs daily at 3:00 AM EDT but finds nothing to delete.",
        ),
      )
      .toBeVisible();
    await chatHistory().getByRole("radio", { name: /For a set time/ }).click();
    await expect.element(retentionAmount()).toHaveValue("1");
    await saveButton().click();

    await expect.element(confirmDialog()).toBeVisible();
    await expect
      .element(confirmDialog())
      .toHaveTextContent("Messages older than 1 year");
  });

  it("keeps the field while 0 is typed on the way to another number", async () => {
    await renderLoaded();

    await retype(retentionAmount(), "0");
    await expect.element(retentionAmount()).toHaveFocus();
    await userEvent.keyboard("6");
    await expect.element(retentionAmount()).toHaveValue("06");
  });

  it("saves a longer period without asking", async () => {
    await renderLoaded();

    await retype(retentionAmount(), "3");
    await saveButton().click();

    await expect.element(page.getByText("Settings saved.")).toBeVisible();
    expect(network.updateSettings.mock.calls[0][0]).toEqual([
      { key: "chat_retention_days", value: "1095" },
    ]);
  });

  it("saves Forever without asking, and Back restores the saved period", async () => {
    await renderLoaded();

    await chatHistory().getByRole("radio", { name: /Forever/ }).click();
    await expect.element(retentionAmount()).not.toBeInTheDocument();
    await chatHistory().getByRole("radio", { name: /For a set time/ }).click();
    await expect.element(retentionAmount()).toHaveValue("2");
    await expect.element(page.getByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();

    await chatHistory().getByRole("radio", { name: /Forever/ }).click();
    await saveButton().click();
    await expect.element(page.getByText("Settings saved.")).toBeVisible();
    expect(network.updateSettings.mock.calls[0][0]).toEqual([
      { key: "chat_retention_days", value: "0" },
    ]);
  });
});

describe("Sign-in protection", () => {
  it("starts collapsed and opens on its head", async () => {
    await renderLoaded();

    await expect.element(signInHead()).toHaveAttribute("aria-expanded", "false");
    expect(page.getByText("These apply to everyone").elements()).toHaveLength(0);

    await openSignIn();
    for (const title of RULE_TITLES) {
      await expect
        .element(signIn().getByRole("group", { name: title, exact: true }))
        .toBeVisible();
    }
    await expect
      .element(signIn().getByRole("button", { name: `About ${RULE_TITLES[1]}` }))
      .toBeVisible();
  });

  it("refuses 0 tries and a window under a minute, and holds Save back", async () => {
    await renderLoaded();
    await openSignIn();
    const rule = signIn().getByRole("group", { name: RULE_TITLES[0], exact: true });

    await retype(rule.getByRole("textbox", { name: "Tries allowed" }), "0");
    await retype(rule.getByRole("textbox", { name: "Within", exact: true }), "0");
    await userEvent.tab();

    await expect.element(rule.getByText("Enter 1 or more tries.")).toBeVisible();
    await expect
      .element(rule.getByText("Enter a time from 1 minute to 31 days."))
      .toBeVisible();
    await expect.element(saveButton()).toBeDisabled();
    expect(network.updateSettings).not.toHaveBeenCalled();
  });

  it("keeps the card open and focus in place while an error is fixed", async () => {
    await renderLoaded();
    await openSignIn();
    const rule = signIn().getByRole("group", { name: RULE_TITLES[0], exact: true });
    const tries = rule.getByRole("textbox", { name: "Tries allowed" });
    await retype(tries, "0");
    await userEvent.tab();

    await expect.element(signIn().getByText("Enter 1 or more tries.")).toBeVisible();
    await expect
      .element(rule.getByRole("textbox", { name: "Within", exact: true }))
      .toHaveFocus();

    await signInHead().click();
    await expect.element(signInHead()).toHaveAttribute("aria-expanded", "true");
    await expect.element(signIn().getByText("Enter 1 or more tries.")).toBeVisible();

    await tries.fill("3");
    await expect.element(tries).toHaveValue("3");
    await expect.element(tries).toHaveFocus();
    await expect.element(signInHead()).toHaveAttribute("aria-expanded", "true");
    expect(signIn().getByText("Enter 1 or more tries.").elements()).toHaveLength(0);
  });

  it("lets a collapsed group collapse again once there is no error", async () => {
    await renderLoaded();
    await openSignIn();
    await signInHead().click();
    await expect.element(signInHead()).toHaveAttribute("aria-expanded", "false");
  });

  it("counts changes inside the collapsed group in the jump list", async () => {
    await renderLoaded();
    await openSignIn();
    const rule = signIn().getByRole("group", { name: RULE_TITLES[0], exact: true });
    await retype(rule.getByRole("textbox", { name: "Tries allowed" }), "6");
    await signInHead().click();

    await expect.element(signInHead()).toHaveAttribute("aria-expanded", "false");
    await expect
      .element(
        page
          .getByRole("navigation", { name: "Settings groups" })
          .getByRole("button", { name: /Sign-in protection.*1 unsaved change/ }),
      )
      .toBeVisible();
  });

  it("saves all eight keys through the one Save bar", async () => {
    await renderLoaded();
    await openSignIn();

    for (const title of RULE_TITLES) {
      const rule = signIn().getByRole("group", { name: title, exact: true });
      await retype(rule.getByRole("textbox", { name: "Tries allowed" }), "7");
      await retype(rule.getByRole("textbox", { name: "Within", exact: true }), "30");
    }
    await expect.element(saveBar()).toHaveTextContent("8 unsaved changes");
    await saveButton().click();

    await expect.element(page.getByText("Settings saved.")).toBeVisible();
    expect(network.updateSettings).toHaveBeenCalledTimes(1);
    expect(network.updateSettings.mock.calls[0][0]).toEqual(
      RULE_PREFIXES.flatMap((prefix) => [
        { key: `${prefix}_max_attempts`, value: "7" },
        { key: `${prefix}_window_seconds`, value: "1800" },
      ]),
    );
  });
});

describe("layout", () => {
  it("stacks the Keep chats cards at 375px and sets them side by side at 1280px", async () => {
    await page.viewport(375, 800);
    await renderLoaded();
    const cards = () =>
      chatHistory()
        .getByRole("radio")
        .elements()
        .map((radio) => radio.closest("label")?.getBoundingClientRect());

    const [stackedA, stackedB] = cards();
    expect(stackedB?.top).toBeGreaterThan(stackedA?.bottom ?? 0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);

    await page.viewport(1280, 900);
    await settleLayout();
    const [sideA, sideB] = cards();
    expect(sideB?.top).toBe(sideA?.top);
  });
});
