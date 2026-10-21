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
  put: vi.fn(),
  logout: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, patch: network.patch, put: network.put },
  requestLogout: network.logout,
}));

const MANAGER = {
  ...ME,
  id: "u-3",
  email: "ana@example.com",
  role: "manager",
  name: "Ana Lima",
  tutor_id: "t-3",
  office_phone: "+15125550100",
};
const TUTOR = {
  ...MANAGER,
  id: "u-7",
  email: "marco@example.com",
  role: "tutor",
  name: "Marco Rossi",
  tutor_id: "t-7",
};
const MONDAY = {
  id: "s-1",
  tutor_id: "t-3",
  day_of_week: 0,
  start_time: "15:00:00",
  end_time: "18:00:00",
  is_active: true,
  mode: "anywhere",
};

function weekOf(items: (typeof MONDAY)[]) {
  return { items, total: items.length, page: 1, page_size: 100 };
}

// `me` for /api/me; every other read is the person's week.
function respondAs(me: object): void {
  network.get.mockImplementation(async (url: string) => ({
    data: url === "/api/me" ? me : weekOf([MONDAY]),
  }));
}

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
  network.put.mockReset();
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

const availabilityHeading = () =>
  page.getByRole("heading", { name: "Your availability" });

describe.each([
  ["desktop", 1280],
  ["phone", 390],
])("Manager availability on %s", (_label, width) => {
  beforeEach(async () => {
    await page.viewport(width, 800);
    useAuthStore.setState({ status: "authenticated", role: "manager" });
  });

  it("shows Your availability with its hint and week", async () => {
    respondAs(MANAGER);
    await renderProfile();
    await expect.element(availabilityHeading()).toBeVisible();
    await expect
      .element(
        page.getByText("You teach too: the bot offers you to Guardians in these times."),
      )
      .toBeVisible();
    await expect.element(page.getByText("3:00 PM – 6:00 PM")).toBeVisible();
    expect(network.get).toHaveBeenCalledWith("/api/tutors/t-3/availability", {
      params: { page: 1, page_size: 100 },
    });
  });

  it("saves the week through PUT", async () => {
    respondAs(MANAGER);
    network.put.mockResolvedValue({
      data: weekOf([{ ...MONDAY, mode: "only_office" }]),
    });
    await renderProfile();
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("combobox", { name: "Monday range 1 location" }).click();
    await page.getByRole("option", { name: "Office only", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect
      .element(page.getByText("Availability saved. The bot offers the new times now."))
      .toBeVisible();
    expect(network.put).toHaveBeenCalledWith("/api/tutors/t-3/availability", {
      slots: [
        {
          day_of_week: 0,
          start_time: "15:00:00",
          end_time: "18:00:00",
          mode: "only_office",
        },
      ],
    });
  });
});

describe("who gets an availability section", () => {
  it("gives a Manager without a teaching profile nothing extra", async () => {
    respondAs({ ...MANAGER, tutor_id: null });
    await renderProfile();
    await expect.element(page.getByText("Ana Lima")).toBeVisible();
    expect(availabilityHeading().elements()).toHaveLength(0);
    expect(network.get).not.toHaveBeenCalledWith(
      expect.stringContaining("/availability"),
      expect.anything(),
    );
  });

  it.each([
    ["an Admin", { ...MANAGER, role: "admin" }],
    ["a Tutor", TUTOR],
  ])("gives %s no availability section", async (_who, me) => {
    respondAs(me);
    await renderProfile();
    await expect.element(page.getByText(me.name)).toBeVisible();
    expect(availabilityHeading().elements()).toHaveLength(0);
  });
});

describe("office phone", () => {
  it("shows a Tutor the office's phone as a call link", async () => {
    respondAs(TUTOR);
    await renderProfile();
    await expect.element(page.getByText("The office:")).toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "+1 (512) 555-0100" }))
      .toHaveAttribute("href", "tel:+15125550100");
  });

  it("shows nothing while the office has no phone", async () => {
    respondAs({ ...TUTOR, office_phone: null });
    await renderProfile();
    await expect.element(page.getByText("Marco Rossi")).toBeVisible();
    expect(page.getByText("The office:").elements()).toHaveLength(0);
  });

  it("is a Tutor's line only", async () => {
    respondAs(MANAGER);
    await renderProfile();
    await expect.element(page.getByText("Ana Lima")).toBeVisible();
    expect(page.getByText("The office:").elements()).toHaveLength(0);
  });
});
