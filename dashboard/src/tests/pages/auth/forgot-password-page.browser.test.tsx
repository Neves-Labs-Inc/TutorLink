import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import ForgotPasswordPage from "@/pages/auth/forgot-password-page";
import { renderWithProviders } from "@/test/render-with-providers";

const network = vi.hoisted(() => ({ forgot: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requestForgotPassword: network.forgot,
}));

const EMAIL = "rita.souza@example.com";
const SERVER_SENTENCE = "If an account exists (server detail)";

function serverError(): AxiosError {
  const response = {
    status: 500,
    statusText: "",
    headers: new AxiosHeaders(),
    data: { detail: "Internal Server Error (server detail)" },
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
  return new AxiosError("Request failed", "ERR_BAD_RESPONSE", undefined, undefined, response);
}

function renderForgot() {
  return renderWithProviders(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<p>Sign-in page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const emailField = () => page.getByLabelText("Email");
const sendButton = () => page.getByRole("button", { name: /Send reset link|Sending/ });
const heading = () => page.getByRole("heading", { level: 1 });

async function sendFor(email: string): Promise<void> {
  await userEvent.fill(emailField(), email);
  await userEvent.click(sendButton());
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.forgot.mockReset();
  network.forgot.mockResolvedValue({ status: 202, data: { detail: SERVER_SENTENCE } });
});

describe("forgot-password page", () => {
  it("confirms with the typed email and the 48-hour window, focused on the new title", async () => {
    await renderForgot();
    await expect.element(heading()).toHaveTextContent("Forgot your password?");

    await sendFor(`  ${EMAIL} `);
    await expect.element(heading()).toHaveTextContent("Check your email");
    expect(network.forgot).toHaveBeenCalledWith(EMAIL);
    expect(document.activeElement).toBe(heading().element());
    await expect
      .element(page.getByText(/we’ve sent it a link to choose a new password/))
      .toHaveTextContent(
        `If there’s an account for ${EMAIL}, we’ve sent it a link to choose a new password. The link works for 48 hours.`,
      );
    expect(document.body.textContent).not.toContain("server detail");
  });

  it("goes back to the form with the email kept and focused on send another link", async () => {
    await renderForgot();
    await sendFor(EMAIL);
    await expect.element(heading()).toHaveTextContent("Check your email");

    await userEvent.click(page.getByRole("button", { name: "send another link" }));
    await expect.element(heading()).toHaveTextContent("Forgot your password?");
    await expect.element(emailField()).toHaveValue(EMAIL);
    expect(document.activeElement).toBe(emailField().element());
  });

  it("goes back to sign in from the confirmation", async () => {
    await renderForgot();
    await sendFor(EMAIL);

    await userEvent.click(page.getByRole("button", { name: "Back to sign in" }));
    await expect.element(page.getByText("Sign-in page")).toBeVisible();
  });

  it("shows the unreachable alert when the request fails, never the server detail", async () => {
    network.forgot.mockRejectedValue(serverError());
    await renderForgot();

    await sendFor(EMAIL);
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent("Couldn’t reach TutorLink");
    await expect.element(alert).toHaveTextContent("Check your connection and try again.");
    await expect.element(heading()).toHaveTextContent("Forgot your password?");
    expect(document.body.textContent).not.toMatch(/server detail|500/);
  });

  it("holds Sending… while the request is in flight", async () => {
    network.forgot.mockReturnValue(new Promise(() => {}));
    await renderForgot();

    await sendFor(EMAIL);
    await expect.element(page.getByRole("button", { name: "Sending…" })).toHaveAttribute("aria-disabled", "true");
  });

  it("checks the email before sending, then again on blur", async () => {
    await renderForgot();

    await userEvent.click(sendButton());
    await expect.element(page.getByText("Enter your email address.")).toBeVisible();
    expect(network.forgot).not.toHaveBeenCalled();

    await userEvent.fill(emailField(), "rita");
    await userEvent.tab();
    await expect
      .element(page.getByText("Enter a full email address, like name@example.com."))
      .toBeVisible();
  });

  it("offers Back to sign in from the form, with autocomplete and one h1", async () => {
    await renderForgot();

    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(emailField().element().getAttribute("autocomplete")).toBe("username");
    expect(emailField().element().getAttribute("inputmode")).toBe("email");
    await userEvent.click(page.getByRole("button", { name: "Back to sign in" }));
    await expect.element(page.getByText("Sign-in page")).toBeVisible();
  });
});
