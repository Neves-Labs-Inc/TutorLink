import { AxiosError } from "axios";
import type { AxiosResponse } from "axios";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type { InitialEntry } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import SetPasswordPage from "@/pages/set-password/set-password-page";
import type { LinkLookupResult, PasswordLink } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const TOKEN = "s3cret-link-token";

const network = vi.hoisted(() => ({
  lookUp: vi.fn(),
  setPassword: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requestLinkLookup: network.lookUp,
  requestSetPassword: network.setPassword,
}));

const VALID_INVITE: PasswordLink = {
  kind: "invite",
  state: "valid",
  name: "Ana Ruiz",
  email: "ana.ruiz@example.com",
};

const VALID_RESET: PasswordLink = {
  kind: "reset",
  state: "valid",
  name: null,
  email: null,
};

function checked(link: PasswordLink): LinkLookupResult {
  return { isRateLimited: false, link };
}

function renderLinkPage(entry: InitialEntry = `/set-password?token=${TOKEN}`) {
  const router = createMemoryRouter(
    [
      { path: "/set-password", element: <SetPasswordPage /> },
      { path: "/login", element: <p>Sign-in page</p> },
      { path: "/forgot-password", element: <p>Forgot page</p> },
      { path: "/home", element: <p>Office home</p> },
      { path: "/sessions", element: <p>Tutor sessions</p> },
    ],
    { initialEntries: [entry] },
  );
  return { router, rendered: renderWithProviders(<RouterProvider router={router} />) };
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.lookUp.mockReset();
  network.setPassword.mockReset();
  useAuthStore.setState({ status: "anonymous", role: null });
});

describe("link check", () => {
  it("shows Welcome with the invitee's name and email for a valid invite", async () => {
    network.lookUp.mockResolvedValue(checked(VALID_INVITE));
    await renderLinkPage().rendered;

    await expect
      .element(page.getByRole("heading", { level: 1, name: "Welcome to TutorLink" }))
      .toBeVisible();
    await expect.element(page.getByText("Ana Ruiz")).toBeVisible();
    await expect.element(page.getByText("ana.ruiz@example.com")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Set password and sign in" }))
      .toBeVisible();
    expect(network.lookUp).toHaveBeenCalledWith(TOKEN);
  });
});

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const heading = (name: string) => page.getByRole("heading", { level: 1, name });

function failure(status: number | null, headers: Record<string, string> = {}): AxiosError {
  const response =
    status === null
      ? undefined
      : ({ status, data: { detail: "refused" }, headers } as unknown as AxiosResponse);
  return new AxiosError("failed", "ERR", undefined, undefined, response);
}

// A token the client can decode (the signature is never checked in the browser).
function accessTokenFor(role: string): string {
  const payload = btoa(JSON.stringify({ sub: "u-1", role, exp: 4_000_000_000 }));
  return `header.${payload.replace(/=+$/, "")}.signature`;
}

async function typePasswords(password: string, confirm: string = password) {
  await userEvent.fill(page.getByLabelText("New password"), password);
  await userEvent.fill(page.getByLabelText("Type it again"), confirm);
}

describe("link check outcomes", () => {
  it("shows Set a new password with no identity for a valid reset", async () => {
    network.lookUp.mockResolvedValue(checked(VALID_RESET));
    await renderLinkPage().rendered;

    await expect.element(heading("Choose a new password")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Save password and sign in" }))
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Back to sign in" })).toBeVisible();
    expect(document.querySelector('input[name="username"]')).toBeNull();
    expect(page.getByText("@example.com").elements()).toHaveLength(0);
  });

  it("puts the invitee's email in a hidden username field and the pill's title", async () => {
    network.lookUp.mockResolvedValue(checked(VALID_INVITE));
    await renderLinkPage().rendered;

    await expect.element(heading("Welcome to TutorLink")).toBeVisible();
    const username = document.querySelector<HTMLInputElement>('input[name="username"]');
    expect(username?.value).toBe("ana.ruiz@example.com");
    expect(username?.autocomplete).toBe("username");
    expect(page.getByTitle("ana.ruiz@example.com").elements()).toHaveLength(1);
    expect(page.getByTitle("Ana Ruiz").elements()).toHaveLength(1);
  });

  const DEAD_CASES = [
    { kind: "invite", state: "expired", title: "This invite has expired", action: "Go to sign in" },
    { kind: "invite", state: "used", title: "This invite has already been used", action: "Go to sign in" },
    { kind: "reset", state: "expired", title: "This reset link has expired", action: "Send a new link" },
    { kind: "reset", state: "used", title: "This reset link has already been used", action: "Send a new link" },
  ] as const;

  for (const { kind, state, title, action } of DEAD_CASES) {
    it(`says "${title}" for a ${state} ${kind} link, with no form`, async () => {
      network.lookUp.mockResolvedValue(
        checked({ kind, state, name: null, email: null }),
      );
      await renderLinkPage().rendered;

      await expect.element(heading(title)).toBeVisible();
      await expect.element(page.getByRole("button", { name: action })).toBeVisible();
      expect(page.getByLabelText("New password").elements()).toHaveLength(0);
    });
  }

  it("sends a dead reset link's owner to Forgot password", async () => {
    network.lookUp.mockResolvedValue(
      checked({ kind: "reset", state: "expired", name: null, email: null }),
    );
    await renderLinkPage().rendered;

    await userEvent.click(page.getByRole("button", { name: "Send a new link" }));
    await expect.element(page.getByText("Forgot page")).toBeVisible();
  });

  it("shows the generic message for an invalid link", async () => {
    network.lookUp.mockResolvedValue(
      checked({ kind: null, state: "invalid", name: null, email: null }),
    );
    await renderLinkPage().rendered;

    await expect.element(heading("This link no longer works")).toBeVisible();
    await expect
      .element(page.getByText("Came from an invite email? Ask an Admin to send you a new one."))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Send me a new reset link" }));
    await expect.element(page.getByText("Forgot page")).toBeVisible();
  });

  it("shows the generic message without calling the API when the token is missing", async () => {
    await renderLinkPage("/set-password").rendered;

    await expect.element(heading("This link no longer works")).toBeVisible();
    expect(network.lookUp).not.toHaveBeenCalled();
  });

  it("shows a text-free skeleton while the link is checked", async () => {
    network.lookUp.mockReturnValue(new Promise(() => {}));
    await renderLinkPage().rendered;

    const skeleton = page.getByRole("status", { name: "Checking your link" });
    await expect.element(skeleton).toBeVisible();
    expect(skeleton.element().textContent).toBe("");
    expect(page.getByRole("heading").elements()).toHaveLength(0);
  });

  it("offers Try again after a failed check, and it re-runs the check", async () => {
    network.lookUp
      .mockRejectedValueOnce(failure(null))
      .mockResolvedValueOnce(checked(VALID_RESET));
    await renderLinkPage().rendered;

    await expect.element(heading("Couldn’t check your link")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Try again" }));
    await expect.element(heading("Choose a new password")).toBeVisible();
    expect(network.lookUp).toHaveBeenCalledTimes(2);
  });

  it("keeps the failure view, with Trying again… and focus, while the retry runs", async () => {
    let finishRetry: (result: LinkLookupResult) => void = () => {};
    network.lookUp
      .mockRejectedValueOnce(failure(503))
      .mockReturnValueOnce(new Promise((resolve) => (finishRetry = resolve)));
    await renderLinkPage().rendered;

    await expect.element(heading("Couldn’t check your link")).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Try again" }));

    const retrying = page.getByRole("button", { name: "Trying again…" });
    await expect.element(retrying).toBeVisible();
    await expect.element(heading("Couldn’t check your link")).toBeVisible();
    expect(page.getByRole("status", { name: "Checking your link" }).elements()).toHaveLength(0);
    // Chromium moves focus off a newly disabled control on the next frames, so wait them out.
    await nextFrame();
    await nextFrame();
    expect(document.activeElement).toBe(retrying.element());

    finishRetry(checked(VALID_RESET));
    await expect.element(heading("Choose a new password")).toBeVisible();
    expect(document.activeElement).toBe(heading("Choose a new password").element());
  });

  it("counts a rate-limit wait down, then offers Try again", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    try {
      network.lookUp
        .mockResolvedValueOnce({ isRateLimited: true, retryAfterSeconds: 300 })
        .mockResolvedValueOnce(checked(VALID_INVITE));
      await renderLinkPage().rendered;

      await expect.element(heading("Too many tries")).toBeVisible();
      await expect.element(page.getByText("5 minutes")).toBeVisible();
      expect(page.getByRole("button", { name: "Try again" }).elements()).toHaveLength(0);

      vi.advanceTimersByTime(240_000);
      await expect.element(page.getByText("1 minute", { exact: true })).toBeVisible();

      vi.advanceTimersByTime(60_000);
      await expect.element(page.getByText("You can try again now.")).toBeVisible();
      expect(page.getByText(/Try again in/).elements()).toHaveLength(0);
      await userEvent.click(page.getByRole("button", { name: "Try again" }));
      await expect.element(heading("Welcome to TutorLink")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the token", () => {
  it("leaves the URL at once and stays out of web storage", async () => {
    localStorage.clear();
    sessionStorage.clear();
    network.lookUp.mockResolvedValue(checked(VALID_INVITE));
    const { router, rendered } = renderLinkPage();
    await rendered;

    await expect.element(heading("Welcome to TutorLink")).toBeVisible();
    expect(router.state.location.pathname).toBe("/set-password");
    expect(router.state.location.search).toBe("");
    expect(router.state.location.state).toEqual({ token: TOKEN });
    const stored = [
      ...Object.values({ ...localStorage }),
      ...Object.values({ ...sessionStorage }),
    ].join("\n");
    expect(stored).not.toContain(TOKEN);
  });

  it("is read back from location state on a reload", async () => {
    network.lookUp.mockResolvedValue(checked(VALID_RESET));
    await renderLinkPage({ pathname: "/set-password", state: { token: TOKEN } }).rendered;

    await expect.element(heading("Choose a new password")).toBeVisible();
    expect(network.lookUp).toHaveBeenCalledWith(TOKEN);
  });
});

describe("password rules", () => {
  beforeEach(() => {
    network.lookUp.mockResolvedValue(checked(VALID_INVITE));
  });

  it("catches a too-short password before sending", async () => {
    await renderLinkPage().rendered;
    await typePasswords("short");
    await userEvent.click(page.getByRole("button", { name: "Set password and sign in" }));

    await expect.element(page.getByText("Use at least 8 characters.")).toBeVisible();
    expect(network.setPassword).not.toHaveBeenCalled();
  });

  it("catches a password over 72 bytes made of multi-byte characters", async () => {
    await renderLinkPage().rendered;
    // 40 characters, 80 bytes in UTF-8.
    await typePasswords("é".repeat(40));
    await userEvent.click(page.getByRole("button", { name: "Set password and sign in" }));

    await expect
      .element(page.getByText("That password is too long. Try a shorter one."))
      .toBeVisible();
    expect(network.setPassword).not.toHaveBeenCalled();
  });

  it("catches a mismatch", async () => {
    await renderLinkPage().rendered;
    await typePasswords("sunflower-42", "sunflower-24");
    await userEvent.click(page.getByRole("button", { name: "Set password and sign in" }));

    await expect.element(page.getByText("The two passwords don’t match.")).toBeVisible();
    expect(network.setPassword).not.toHaveBeenCalled();
  });
});

describe("saving", () => {
  it("signs in and lands on the role's landing page", async () => {
    network.lookUp.mockResolvedValue(checked(VALID_INVITE));
    network.setPassword.mockResolvedValue({ data: { access_token: accessTokenFor("tutor") } });
    await renderLinkPage().rendered;

    await typePasswords("sunflower-42");
    await userEvent.click(page.getByRole("button", { name: "Set password and sign in" }));

    await expect.element(page.getByText("Tutor sessions")).toBeVisible();
    expect(network.setPassword).toHaveBeenCalledWith(TOKEN, "sunflower-42");
    expect(useAuthStore.getState().role).toBe("tutor");
  });

  it("shows a 422 under New password", async () => {
    network.lookUp.mockResolvedValue(checked(VALID_RESET));
    network.setPassword.mockRejectedValue(failure(422));
    await renderLinkPage().rendered;

    await typePasswords("sunflower-42");
    await userEvent.click(page.getByRole("button", { name: "Save password and sign in" }));

    await expect
      .element(page.getByText("That password is too long. Try a shorter one."))
      .toBeVisible();
    await expect.element(page.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");
  });

  it("keeps the form and says the link still works when the save can't reach the server", async () => {
    network.lookUp.mockResolvedValue(checked(VALID_RESET));
    network.setPassword.mockRejectedValue(failure(null));
    await renderLinkPage().rendered;

    await typePasswords("sunflower-42");
    await userEvent.click(page.getByRole("button", { name: "Save password and sign in" }));

    const alert = page.getByRole("alert");
    await expect.element(alert.getByText("Couldn’t save your password")).toBeVisible();
    await expect.element(alert.getByText(/Your link still works\./)).toBeVisible();
    await expect.element(page.getByLabelText("New password")).toBeEnabled();
  });

  it("switches to the kind's dead-link view on a 400 and focuses its heading", async () => {
    network.lookUp
      .mockResolvedValueOnce(checked(VALID_INVITE))
      .mockResolvedValueOnce(checked({ ...VALID_INVITE, state: "used" }));
    network.setPassword.mockRejectedValue(failure(400));
    await renderLinkPage().rendered;

    await typePasswords("sunflower-42");
    await userEvent.click(page.getByRole("button", { name: "Set password and sign in" }));

    await expect.element(heading("This invite has already been used")).toBeVisible();
    expect(document.activeElement).toBe(heading("This invite has already been used").element());
  });

  it("falls back to the expired view when the re-check after a 400 still says valid", async () => {
    network.lookUp.mockResolvedValue(checked(VALID_RESET));
    network.setPassword.mockRejectedValue(failure(400));
    await renderLinkPage().rendered;

    await typePasswords("sunflower-42");
    await userEvent.click(page.getByRole("button", { name: "Save password and sign in" }));

    await expect.element(heading("This reset link has expired")).toBeVisible();
  });
});
