import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { QueryClient } from "@tanstack/react-query";
import KitRoot from "@/components/kit/kit-root";
import { LandingWelcome } from "@/components/layout/landing-welcome";
import type { Role } from "@/lib/auth/auth";
import { useAuthStore } from "@/stores/authStore";
import { createTestQueryClient, renderWithProviders } from "@/test/render-with-providers";

const ME = {
  id: "u-1",
  email: "rita.souza@example.com",
  role: "admin",
  name: "Rita Souza",
  welcome_seen: false,
};
const TITLE = "Welcome to TutorLink";
// Long enough that a card arriving late would have shown by now.
const SETTLE_MS = 300;

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, post: network.post },
}));

function renderWelcome(queryClient: QueryClient = createTestQueryClient()) {
  return renderWithProviders(
    <KitRoot theme="light" height="600px">
      <h1>Home</h1>
      <LandingWelcome />
      <p>Page content</p>
    </KitRoot>,
    queryClient,
  );
}

const card = () => page.getByRole("region", { name: TITLE });
const settle = () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.post.mockReset();
  network.get.mockResolvedValue({ data: ME });
  network.post.mockResolvedValue({ data: undefined, status: 204 });
  useAuthStore.setState({ status: "authenticated", role: "admin" });
});

describe("LandingWelcome visibility", () => {
  it("shows the card while the welcome hasn't been seen", async () => {
    await renderWelcome();

    await expect.element(card()).toBeVisible();
    expect(network.get).toHaveBeenCalledWith("/api/me");
  });

  it("renders nothing while the profile loads", async () => {
    network.get.mockReturnValue(new Promise(() => {}));
    await renderWelcome();
    await expect.element(page.getByText("Page content")).toBeVisible();

    await settle();

    await expect.element(card()).not.toBeInTheDocument();
  });

  it("renders nothing when the profile fails to load", async () => {
    network.get.mockRejectedValue(new Error("500"));
    await renderWelcome();

    await settle();

    await expect.element(card()).not.toBeInTheDocument();
  });

  it("renders nothing once the welcome has been seen", async () => {
    network.get.mockResolvedValue({ data: { ...ME, welcome_seen: true } });
    await renderWelcome();

    await settle();

    await expect.element(card()).not.toBeInTheDocument();
  });
});

describe("LandingWelcome dismiss", () => {
  it("hides the card, posts once and records the welcome as seen", async () => {
    const queryClient = createTestQueryClient();
    await renderWelcome(queryClient);
    await expect.element(card()).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Dismiss welcome" }));

    await expect.element(card()).not.toBeInTheDocument();
    await expect.poll(() => network.post.mock.calls.length).toBe(1);
    expect(network.post).toHaveBeenCalledWith("/api/me/welcome-seen");
    await expect
      .poll(() => queryClient.getQueryData<typeof ME>(["me"])?.welcome_seen)
      .toBe(true);
    await settle();
    expect(network.post).toHaveBeenCalledTimes(1);
  });

  it("posts at the click, even when the page leaves before the fade ends", async () => {
    const screen = await renderWelcome();
    await expect.element(card()).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Dismiss welcome" }));
    expect(network.post).toHaveBeenCalledTimes(1);
    await screen.unmount();

    expect(network.post).toHaveBeenCalledWith("/api/me/welcome-seen");
    expect(network.post).toHaveBeenCalledTimes(1);
  });

  it("keeps playing the fade when the seen flag lands mid-fade", async () => {
    const queryClient = createTestQueryClient();
    await renderWelcome(queryClient);
    await expect.element(card()).toBeVisible();
    const section = card().element();

    await userEvent.click(page.getByRole("button", { name: "Dismiss welcome" }));
    await expect
      .poll(() => queryClient.getQueryData<typeof ME>(["me"])?.welcome_seen)
      .toBe(true);

    expect(section.isConnected).toBe(true);
    await expect.poll(() => section.isConnected).toBe(false);
  });

  it("stays hidden with no message when the post fails, and returns on the next load", async () => {
    network.post.mockRejectedValue(new Error("500"));
    const queryClient = createTestQueryClient();
    const screen = await renderWelcome(queryClient);
    await expect.element(card()).toBeVisible();

    await userEvent.click(page.getByRole("button", { name: "Dismiss welcome" }));

    await expect.poll(() => network.post.mock.calls.length).toBe(1);
    await expect.poll(() => queryClient.isMutating()).toBe(0);
    await expect.element(card()).not.toBeInTheDocument();
    expect(page.getByRole("alert").elements()).toHaveLength(0);
    expect(queryClient.getQueryData<typeof ME>(["me"])?.welcome_seen).toBe(false);

    await screen.unmount();
    await renderWelcome(queryClient);

    await expect.element(card()).toBeVisible();
  });
});

describe("LandingWelcome copy", () => {
  const COPY: { roles: Role[]; body: string }[] = [
    {
      roles: ["admin", "developer"],
      body: "Home shows what needs you today: chats, Bookings and Time off waiting in To do. Families, Staff and Settings are in the menu.",
    },
    {
      roles: ["manager"],
      body: "Home shows the chats and Bookings waiting in To do. Your own Bookings are under Bookings with Mine on, and your Availability is on your Profile.",
    },
    {
      roles: ["tutor"],
      body: "My sessions lists your coming Sessions, with each Child’s notes. Set when you can work in My availability, and ask for Time off under Time off.",
    },
  ];

  for (const { roles, body } of COPY) {
    for (const role of roles) {
      it(`welcomes a ${role} with their landing page's copy`, async () => {
        useAuthStore.setState({ role });
        network.get.mockResolvedValue({ data: { ...ME, role } });
        await renderWelcome();

        await expect.element(page.getByRole("heading", { name: TITLE })).toBeVisible();
        await expect.element(page.getByText(body)).toBeVisible();
        expect(card().element().querySelectorAll("a")).toHaveLength(0);
        expect(card().element().querySelectorAll("button")).toHaveLength(1);
      });
    }
  }
});
