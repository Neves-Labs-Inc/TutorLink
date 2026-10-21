import { queryOptions, skipToken } from "@tanstack/react-query";
import { AxiosError } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import AppLayout from "@/components/layout/app-layout";
import type { SettingsPage as SettingsWire } from "@/lib/queries/settings";
import type { Setting } from "@/lib/settings/settings";
import SettingsPage from "@/pages/settings/settings-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";
import { settleLayout } from "@/test/settleLayout";

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 375, height: 800 };

const network = vi.hoisted(() => ({
  get: vi.fn(),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getPreview: vi.fn(),
  sendTest: vi.fn(),
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
    emailPreview: (payload: unknown) =>
      queryOptions({
        queryKey: ["settings", "email-preview", payload],
        queryFn: payload === null ? skipToken : () => network.getPreview(payload),
        retry: false,
      }),
  },
  updateSettings: network.updateSettings,
  sendTestEmail: network.sendTest,
}));

const ME = { id: "u-1", email: "rita@example.com", role: "admin", name: "Rita" };

function row(key: string, value: string): Setting {
  return { key, value, value_type: "string", is_developer_only: false };
}

const ROWS = [
  row("session_length_minutes", "50"),
  row("email_invite_subject", "Welcome to TutorLink"),
  row("email_invite_body", "Hi {name}, open {link}"),
  row("email_invite_brand_color", "#74C8C9"),
  row("email_reset_subject", "Reset your password"),
  row("email_reset_body", "Open {link}"),
  row("email_reset_brand_color", "#CB9BC3"),
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

function networkError(): AxiosError {
  return new AxiosError("Network Error", "ERR_NETWORK");
}

async function renderSettings(): Promise<void> {
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
    .element(page.getByRole("heading", { name: "Emails" }))
    .toBeVisible();
  await settleLayout();
}

const inviteRow = () => page.getByRole("button", { name: /^Invite email/ });
const resetRow = () =>
  page.getByRole("button", { name: /^Password reset email/ });
const editor = () => page.getByRole("dialog", { name: "Invite email" });
const subject = () => editor().getByRole("textbox", { name: "Subject" });
const message = () => editor().getByRole("textbox", { name: "Message" });
const colourCode = () => editor().getByRole("textbox", { name: "Colour code" });
const saveEmail = () => editor().getByRole("button", { name: "Save email" });
const sendTest = () => editor().getByRole("button", { name: "Send me a test" });
const cancel = () => editor().getByRole("button", { name: "Cancel" });

async function openInvite(): Promise<void> {
  await inviteRow().click();
  await expect.element(editor()).toBeVisible();
}

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  network.get.mockReset();
  network.get.mockImplementation(async (url: string) => ({
    data: url === "/api/me" ? ME : {},
  }));
  network.getSettings.mockReset();
  network.getSettings.mockResolvedValue(wire(ROWS));
  network.updateSettings.mockReset();
  network.updateSettings.mockImplementation(
    async (updates: { key: string; value: string }[]) =>
      wire(
        ROWS.map((item) => {
          const update = updates.find(({ key }) => key === item.key);
          return update ? { ...item, value: update.value } : item;
        }),
      ),
  );
  network.getPreview.mockReset();
  network.getPreview.mockImplementation(
    async (payload: { brand_color: string }) => ({
      subject: "Welcome",
      html: `<!doctype html><html><head></head><body><a style="background:${payload.brand_color}">Choose your password</a></body></html>`,
    }),
  );
  network.sendTest.mockReset();
  network.sendTest.mockResolvedValue(undefined);
});

describe("the Emails group", () => {
  it("shows each email with its saved subject and its own colour", async () => {
    await renderSettings();

    await expect.element(inviteRow()).toContainElement(
      page.getByText("Sent when you invite someone to the dashboard.").element(),
    );
    await expect
      .element(page.getByText("Subject: Welcome to TutorLink"))
      .toBeVisible();
    await expect.element(page.getByText("Button colour #74C8C9")).toBeInTheDocument();
    await expect
      .element(page.getByText("Subject: Reset your password"))
      .toBeVisible();
    await expect.element(page.getByText("Button colour #CB9BC3")).toBeInTheDocument();
    expect(inviteRow().element().getBoundingClientRect().height).toBeGreaterThanOrEqual(72);
    expect(page.getByText("Changing it here changes the other email too.").elements()).toHaveLength(0);
  });

  it("opens an editor with the saved values and no shared-colour note", async () => {
    await renderSettings();
    await openInvite();

    await expect.element(subject()).toHaveValue("Welcome to TutorLink");
    await expect.element(message()).toHaveValue("Hi {name}, open {link}");
    await expect.element(colourCode()).toHaveValue("#74C8C9");
    await expect
      .element(editor().getByText("Changes here save on their own, not with the page."))
      .toBeVisible();
    expect(editor().getByText(/Shared by/).elements()).toHaveLength(0);
  });
});

describe("saving an email", () => {
  it("sends that email's three keys in one PATCH, toasts, closes and leaves the page Save bar alone", async () => {
    await renderSettings();
    await openInvite();

    await subject().fill("You’re invited");
    await message().fill("Hello {name}, start here: {link}");
    await editor().getByRole("button", { name: "Lavender" }).click();
    await expect.element(editor().getByText("Changed")).toBeVisible();
    expect(page.getByRole("region", { name: "Unsaved changes" }).elements()).toHaveLength(0);

    await saveEmail().click();

    await expect.poll(() => network.updateSettings.mock.calls.length).toBe(1);
    // TanStack adds a context argument; only the payload matters.
    expect(network.updateSettings.mock.calls[0][0]).toEqual([
      { key: "email_invite_subject", value: "You’re invited" },
      { key: "email_invite_body", value: "Hello {name}, start here: {link}" },
      { key: "email_invite_brand_color", value: "#CB9BC3" },
    ]);
    await expect.element(page.getByText("Invite email saved.")).toBeVisible();
    await expect.element(editor()).not.toBeInTheDocument();
    await expect.element(page.getByText("Subject: You’re invited")).toBeVisible();
    await expect.element(page.getByText("Button colour #CB9BC3").first()).toBeInTheDocument();
    await expect.element(inviteRow()).toHaveFocus();
  });

  it("keeps Save email off until something changes", async () => {
    await renderSettings();
    await openInvite();
    await expect.element(saveEmail()).toBeDisabled();

    await subject().fill("A new subject");
    await expect.element(saveEmail()).toBeEnabled();
  });

  it("keeps the editor open with an alert when the save fails", async () => {
    network.updateSettings.mockRejectedValue(networkError());
    await renderSettings();
    await openInvite();
    await subject().fill("A new subject");

    await saveEmail().click();

    await expect
      .element(
        editor().getByRole("alert").getByText(
          "Couldn’t save the email. Check your connection and try again.",
        ),
      )
      .toBeVisible();
    await expect.element(subject()).toHaveValue("A new subject");
  });

  it("discards edits when the editor is cancelled", async () => {
    await renderSettings();
    await openInvite();
    await subject().fill("Throwaway");
    await editor().getByRole("button", { name: "Olive" }).click();
    await cancel().click();
    await expect.element(editor()).not.toBeInTheDocument();
    expect(network.updateSettings).not.toHaveBeenCalled();

    await openInvite();
    await expect.element(subject()).toHaveValue("Welcome to TutorLink");
    await expect.element(colourCode()).toHaveValue("#74C8C9");
  });
});

describe("placeholders and validation", () => {
  it("inserts a placeholder at the cursor and keeps the caret after it", async () => {
    await renderSettings();
    await openInvite();
    await message().fill("Hi , open {link}");
    const textarea = message().element() as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(3, 3);

    await editor().getByRole("button", { name: /Who invited them/ }).click();

    await expect.element(message()).toHaveValue("Hi {actor_name}, open {link}");
    await expect.element(message()).toHaveFocus();
    expect(textarea.selectionStart).toBe(3 + "{actor_name}".length);
  });

  it("offers only the placeholders this email supports", async () => {
    await renderSettings();
    await resetRow().click();
    const reset = page.getByRole("dialog", { name: "Password reset email" });

    await expect.element(reset.getByRole("button", { name: /Their name/ })).toBeVisible();
    expect(reset.getByRole("button", { name: /Who invited them/ }).elements()).toHaveLength(0);
  });

  it("shows the API's messages and disables Save and Send me a test", async () => {
    await renderSettings();
    await openInvite();

    await message().fill("No button here");
    await expect
      .element(editor().getByText("The body must include {link}."))
      .toBeVisible();
    await expect.element(saveEmail()).toBeDisabled();
    await expect.element(sendTest()).toBeDisabled();

    await message().fill("Open {link}");
    await colourCode().fill("teal");
    await expect
      .element(editor().getByText("Enter a colour like #74C8C9."))
      .toBeVisible();
    await expect.element(saveEmail()).toBeDisabled();
    await expect.element(sendTest()).toBeDisabled();
  });

  it("lays out placeholder chips and colour presets at 44px with gaps", async () => {
    await renderSettings();
    await openInvite();

    for (const name of ["Turquoise", "Lavender", "Beige/Gold", "Olive"]) {
      const preset = editor().getByRole("button", { name });
      expect(preset.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    const chip = editor().getByRole("button", { name: /Their name/ });
    expect(chip.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  });
});

describe("preview and test send", () => {
  it("renders the API's HTML with the draft colour", async () => {
    await renderSettings();
    await openInvite();
    await editor().getByRole("button", { name: "Preview" }).click();

    const frame = editor().getByTitle("Invite email preview");
    await expect
      .poll(() => (frame.element() as HTMLIFrameElement).srcdoc)
      .toContain("background:#74C8C9");
    await expect
      .element(editor().getByText("As Alex Smith would see it. Names are examples."))
      .toBeVisible();

    await editor().getByRole("button", { name: "Olive" }).click();
    await expect
      .poll(() => (frame.element() as HTMLIFrameElement).srcdoc)
      .toContain("background:#C4BD82");
  });

  it("shows a skeleton while the preview loads", async () => {
    network.getPreview.mockImplementation(() => new Promise(() => {}));
    await renderSettings();
    await openInvite();
    await editor().getByRole("button", { name: "Preview" }).click();

    await expect
      .element(editor().getByRole("status", { name: "Loading preview" }))
      .toBeVisible();
  });

  it("offers Try again when the preview fails", async () => {
    network.getPreview.mockRejectedValueOnce(networkError());
    await renderSettings();
    await openInvite();
    await editor().getByRole("button", { name: "Preview" }).click();

    await expect
      .element(editor().getByText("Couldn’t load the preview"))
      .toBeVisible();
    await editor().getByRole("button", { name: "Try again" }).click();
    await expect
      .poll(() => (editor().getByTitle("Invite email preview").element() as HTMLIFrameElement).srcdoc)
      .toContain("Choose your password");
  });

  it("asks to fix the field instead of previewing an invalid draft", async () => {
    await renderSettings();
    await openInvite();
    await message().fill("No button here");
    await editor().getByRole("button", { name: "Preview" }).click();

    await expect
      .element(editor().getByText("Fix the highlighted field to update the preview."))
      .toBeVisible();
  });

  it("sends the draft to me and toasts with my email", async () => {
    await renderSettings();
    await openInvite();
    await subject().fill("Draft subject");
    await editor().getByRole("button", { name: "Lavender" }).click();

    await sendTest().click();

    await expect.poll(() => network.sendTest.mock.calls.length).toBe(1);
    expect(network.sendTest.mock.calls[0][0]).toEqual({
      template: "invite",
      subject: "Draft subject",
      body: "Hi {name}, open {link}",
      brand_color: "#CB9BC3",
    });
    await expect.element(page.getByText("Test sent to rita@example.com.")).toBeVisible();
    expect(network.updateSettings).not.toHaveBeenCalled();
  });

  it("shows an alert when the test can't be sent", async () => {
    network.sendTest.mockRejectedValue(networkError());
    await renderSettings();
    await openInvite();

    await sendTest().click();

    await expect
      .element(
        editor().getByRole("alert").getByText(
          "Couldn’t send the test. Check your connection and try again.",
        ),
      )
      .toBeVisible();
  });
});

describe("on a phone", () => {
  it("opens as a page with a Settings back button and stacked footer buttons", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await renderSettings();
    await openInvite();

    await expect.element(editor().getByRole("button", { name: "Settings" })).toBeVisible();
    const boxes = [saveEmail(), sendTest(), cancel()].map((button) =>
      button.element().getBoundingClientRect(),
    );
    expect(boxes[0].top).toBeLessThan(boxes[1].top);
    expect(boxes[1].top).toBeLessThan(boxes[2].top);
    expect(boxes[0].width).toBeCloseTo(boxes[2].width, 0);
  });
});
