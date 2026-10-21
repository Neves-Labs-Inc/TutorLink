import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import SignInPage from "@/pages/auth/sign-in-page";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const network = vi.hoisted(() => ({ login: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requestLogin: network.login,
}));

const EMAIL = "rita.souza@example.com";
const PASSWORD = "sunflower-42";
const FIVE_MINUTES_MS = 5 * 60 * 1000;

function encodeToken(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "none" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}

function httpError(
  status: number,
  headers: Record<string, string> = {},
): AxiosError {
  const response = {
    status,
    statusText: "",
    headers: new AxiosHeaders(headers),
    data: { detail: "Incorrect username or password (server detail)" },
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, undefined, response);
}

function networkError(): AxiosError {
  return new AxiosError("Network Error", "ERR_NETWORK");
}

function renderSignIn() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/login" element={<SignInPage />} />
        <Route path="/forgot-password" element={<p>Forgot page</p>} />
        <Route path="/home" element={<p>Office home</p>} />
        <Route path="/sessions" element={<p>Tutor sessions</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const emailField = () => page.getByLabelText("Email");
const passwordField = () => page.getByLabelText("Password", { exact: true });
const signInButton = () => page.getByRole("button", { name: /Sign in|Signing in/ });

async function fillAndSubmit(): Promise<void> {
  await userEvent.fill(emailField(), EMAIL);
  await userEvent.fill(passwordField(), PASSWORD);
  await userEvent.click(signInButton());
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.login.mockReset();
  useAuthStore.setState({ status: "anonymous", role: null, accessToken: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sign-in page", () => {
  it("shows the one wrong-details message on a 401, and editing clears it", async () => {
    network.login.mockRejectedValue(httpError(401));
    await renderSignIn();

    await fillAndSubmit();
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent("That email and password don’t match");
    await expect
      .element(alert)
      .toHaveTextContent(
        "Check both and try again. Haven’t chosen a password yet? Use the link in your invite email.",
      );
    expect(document.body.textContent).not.toContain("server detail");
    expect(document.body.textContent).not.toContain("401");

    await userEvent.type(passwordField(), "x");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });

  it("pauses sign-in for the Retry-After wait, then re-enables it", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    network.login.mockRejectedValue(httpError(429, { "Retry-After": "300" }));
    await renderSignIn();

    await fillAndSubmit();
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Too many sign-in attempts");
    await expect
      .element(alert)
      .toHaveTextContent("For your security, sign-in is paused. Try again in 5 minutes.");
    expect(alert.element().textContent).not.toMatch(/email address|network|IP/i);
    // The ticking count sits outside the live announcement.
    expect(alert.element().querySelector('[aria-live="off"]')?.textContent).toBe("5 minutes");
    await expect.element(signInButton()).toBeDisabled();

    // Editing does not lift a lockout.
    await userEvent.type(passwordField(), "x");
    await expect.element(signInButton()).toBeDisabled();

    vi.advanceTimersByTime(FIVE_MINUTES_MS - 30_000);
    await expect.element(alert).toHaveTextContent("Try again in 1 minute.");
    await expect.element(signInButton()).toBeDisabled();

    vi.advanceTimersByTime(30_000);
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await expect.element(signInButton()).toBeEnabled();
  });

  it("falls back to a 15-minute wait when Retry-After is missing", async () => {
    network.login.mockRejectedValue(httpError(429));
    await renderSignIn();

    await fillAndSubmit();
    await expect.element(page.getByRole("alert")).toHaveTextContent("Try again in 15 minutes.");
  });

  for (const [label, failure] of [
    ["no response", networkError],
    ["a 5xx", () => httpError(503)],
  ] as const) {
    it(`shows the unreachable alert on ${label}, and editing clears it`, async () => {
      network.login.mockRejectedValue(failure());
      await renderSignIn();

      await fillAndSubmit();
      const alert = page.getByRole("alert");
      await expect.element(alert).toHaveTextContent("Couldn’t reach TutorLink");
      await expect.element(alert).toHaveTextContent("Check your connection and try again.");
      expect(alert.element().querySelector("svg")?.getAttribute("class")).toContain(
        "lucide-wifi-off",
      );
      expect(document.body.textContent).not.toContain("server detail");
      expect(document.body.textContent).not.toMatch(/503|Network Error/);

      await userEvent.type(emailField(), "x");
      await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    });
  }

  it("checks fields before sending, then again on blur after the first submit", async () => {
    await renderSignIn();

    await userEvent.fill(emailField(), "rita");
    await userEvent.tab();
    expect(document.body.textContent).not.toContain("Enter a full email address");

    await userEvent.click(signInButton());
    await expect
      .element(page.getByText("Enter a full email address, like name@example.com."))
      .toBeVisible();
    await expect.element(page.getByText("Enter your password.")).toBeVisible();
    expect(network.login).not.toHaveBeenCalled();

    await userEvent.fill(emailField(), EMAIL);
    await userEvent.tab();
    await expect
      .element(page.getByText("Enter a full email address, like name@example.com."))
      .not.toBeInTheDocument();
  });

  it("holds Signing in… through the redirect to the role's landing page", async () => {
    let resolveLogin: (value: unknown) => void = () => {};
    network.login.mockReturnValue(new Promise((resolve) => (resolveLogin = resolve)));
    await renderSignIn();

    await fillAndSubmit();
    await expect.element(page.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(network.login).toHaveBeenCalledWith(EMAIL, PASSWORD);

    resolveLogin({ data: { access_token: encodeToken({ sub: "u-1", role: "tutor", tutor_id: "t-1", exp: 4_102_444_800 }) } });
    await expect.element(page.getByText("Tutor sessions")).toBeVisible();
  });

  it("sends someone already signed in to their landing page", async () => {
    useAuthStore.setState({ status: "authenticated", role: "admin" });
    await renderSignIn();

    await expect.element(page.getByText("Office home")).toBeVisible();
  });

  it("renders one h1, autocomplete hints and Sign in wording", async () => {
    await renderSignIn();

    await expect
      .element(page.getByRole("heading", { level: 1, name: "Welcome back" }))
      .toBeVisible();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(emailField().element().getAttribute("autocomplete")).toBe("username");
    expect(emailField().element().getAttribute("inputmode")).toBe("email");
    expect(passwordField().element().getAttribute("autocomplete")).toBe("current-password");
    await expect.element(page.getByText("Trouble signing in? Ask an Admin.")).toBeVisible();
    await expect
      .element(page.getByText("New here? Use the link in your invite email."))
      .toBeVisible();
    expect(document.body.textContent).not.toMatch(/log ?in|signed out/i);

    await userEvent.click(page.getByRole("button", { name: "Forgot password?" }));
    await expect.element(page.getByText("Forgot page")).toBeVisible();
  });

  it("fits a 320px screen without sideways scroll, with 44px controls", async () => {
    await page.viewport(320, 700);
    await renderSignIn();
    await expect.element(signInButton()).toBeVisible();

    const scroller = document.querySelector("[data-kit-scroll]") as HTMLElement;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
    for (const control of [emailField(), passwordField(), signInButton()]) {
      expect(control.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
