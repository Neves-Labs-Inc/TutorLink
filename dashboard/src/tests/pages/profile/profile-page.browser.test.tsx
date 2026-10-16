import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import ProfilePage from "@/pages/profile/profile-page";
import { useAuthStore } from "@/stores/authStore";
import { startThemeSync, useThemeStore } from "@/stores/theme-store";
import { renderWithProviders } from "@/test/render-with-providers";

const ME = {
  id: "u-1",
  email: "rita.souza@example.com",
  role: "admin",
  name: "Rita Souza",
};

const network = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, patch: network.patch },
  requestLogout: network.logout,
}));

function renderProfile() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/profile"]}>
      <Routes>
        <Route
          path="/profile"
          element={
            <KitRoot theme="light">
              <ProfilePage />
            </KitRoot>
          }
        />
        <Route path="/login" element={<p>Sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const html = () => document.documentElement;
const nameField = () => page.getByRole("textbox", { name: "Display name" });

beforeAll(() => {
  startThemeSync();
});

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.patch.mockReset();
  network.logout.mockReset();
  network.get.mockResolvedValue({ data: ME });
  network.logout.mockResolvedValue(undefined);
  useAuthStore.setState({ status: "authenticated", role: "admin" });
  useThemeStore.getState().setPreference("system");
});

describe("profile identity", () => {
  it("shows the name, role label and email", async () => {
    await renderProfile();
    await expect.element(page.getByText("Rita Souza")).toBeVisible();
    await expect.element(page.getByText("Admin")).toBeVisible();
    await expect.element(page.getByText("rita.souza@example.com")).toBeVisible();
  });

  it("keeps Sign out usable, in place, while the profile loads", async () => {
    network.get.mockReturnValue(new Promise(() => {}));
    await renderProfile();
    const skeleton = page.getByRole("status", { name: "Loading your profile" });
    await expect.element(skeleton).toBeVisible();
    const signOut = skeleton.getByRole("button", { name: "Sign out" });
    await expect.element(signOut).toBeVisible();
    expect(page.getByRole("button", { name: "Sign out" }).elements()).toHaveLength(1);
  });

  it("offers Try again when the profile fails to load, and keeps Sign out", async () => {
    network.get.mockRejectedValueOnce(new Error("500"));
    await renderProfile();
    await expect
      .element(
        page.getByText(
          "Couldn’t load your profile. Check your connection and try again.",
        ),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Sign out" }))
      .toBeVisible();

    network.get.mockReturnValueOnce(new Promise(() => {}));
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(page.getByText("Trying again…")).toBeVisible();
    expect(page.getByRole("status").elements()).toHaveLength(0);
  });
});

describe("display name", () => {
  it("saves a new name, closes the sheet and says so", async () => {
    network.patch.mockResolvedValue({ data: { ...ME, name: "Rita S." } });
    await renderProfile();
    await page.getByRole("button", { name: "Edit display name" }).click();
    await nameField().fill("Rita S.");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.element(page.getByText("Display name saved.")).toBeVisible();
    expect(network.patch).toHaveBeenCalledWith("/api/me", { name: "Rita S." });
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByText("Rita S.").first()).toBeVisible();
  });

  it("shows the field error for an empty name and sends nothing", async () => {
    await renderProfile();
    await page.getByRole("button", { name: "Edit display name" }).click();
    await nameField().fill("");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .element(page.getByText("Display name is required."))
      .toBeVisible();
    expect(network.patch).not.toHaveBeenCalled();
  });

  it("keeps the sheet open with an alert when saving fails", async () => {
    network.patch.mockRejectedValue(new Error("500"));
    await renderProfile();
    await page.getByRole("button", { name: "Edit display name" }).click();
    await nameField().fill("Rita S.");
    await page.getByRole("button", { name: "Save" }).click();

    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Couldn’t save your Display name. Try again.");
    await expect.element(page.getByRole("dialog")).toBeVisible();
  });

  it("cannot be closed while the save is in flight", async () => {
    network.patch.mockReturnValue(new Promise(() => {}));
    await renderProfile();
    await page.getByRole("button", { name: "Edit display name" }).click();
    await nameField().fill("Rita S.");
    await page.getByRole("button", { name: "Save" }).click();

    await expect.element(page.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).toBeVisible();
  });

  it("closes without a request when the name is unchanged", async () => {
    await renderProfile();
    await page.getByRole("button", { name: "Edit display name" }).click();
    await page.getByRole("button", { name: "Save" }).click();

    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(network.patch).not.toHaveBeenCalled();
  });
});

describe("appearance", () => {
  it("applies the choice at once and remembers it after a remount", async () => {
    const view = await renderProfile();
    await page.getByRole("radio", { name: /Dark/ }).click();
    expect(html().dataset.theme).toBe("dark");

    await view.unmount();
    await renderProfile();
    await expect
      .element(page.getByRole("radio", { name: /Dark/ }))
      .toBeChecked();
    expect(html().dataset.theme).toBe("dark");

    await page.getByRole("radio", { name: /Light/ }).click();
    expect(html().dataset.theme).toBe("light");
  });
});

describe("sign out", () => {
  it("signs out and lands on the sign-in page", async () => {
    await renderProfile();
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect.element(page.getByText("Sign-in page")).toBeVisible();
    expect(network.logout).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().status).toBe("anonymous");
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
