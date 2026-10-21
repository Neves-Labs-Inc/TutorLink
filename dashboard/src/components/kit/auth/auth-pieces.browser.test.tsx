import { useState } from "react";
import { Mail } from "lucide-react";
import { describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { AuthFrame, AuthFrameSkeleton } from "@/components/kit/auth/auth-frame";
import SplashScreen from "@/components/kit/auth/splash-screen";
import { PasswordField } from "@/components/kit/components/fields";
import { getControlClasses } from "@/components/kit/lib/control-classes";
import { FormAlert } from "@/components/kit/states/states";

describe("PasswordField", () => {
  it("toggles visibility, renames the button and keeps focus in the field", async () => {
    await render(
      <KitRoot theme="light">
        <PasswordField label="Password" autoComplete="current-password" />
      </KitRoot>,
    );
    const input = page.getByLabelText("Password", { exact: true }).element() as HTMLInputElement;
    await userEvent.click(input);
    expect(input.type).toBe("password");

    await userEvent.click(page.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(document.activeElement).toBe(input);

    await userEvent.click(page.getByRole("button", { name: "Hide password" }));
    expect(input.type).toBe("password");
    expect(document.activeElement).toBe(input);
  });

  it("takes its outline from getControlClasses and passes autoComplete through", async () => {
    await render(
      <KitRoot theme="light">
        <PasswordField
          label="New password"
          autoComplete="new-password"
          error="Use at least 8 characters."
        />
      </KitRoot>,
    );
    const input = page.getByLabelText("New password").element();
    expect(input.className).toContain(getControlClasses(true));
    expect(input.getAttribute("autocomplete")).toBe("new-password");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("onpaste")).toBeNull();
    await expect
      .element(page.getByText("Use at least 8 characters."))
      .toBeVisible();
  });
});

describe("FormAlert", () => {
  const CASES = [
    { tone: "danger", role: "alert" },
    { tone: "warning", role: "alert" },
    { tone: "info", role: "status" },
    { tone: "success", role: "status" },
  ] as const;

  for (const { tone, role } of CASES) {
    it(`announces the ${tone} tone as ${role}`, async () => {
      await render(
        <KitRoot theme="dark">
          <FormAlert tone={tone} title="Heads up">
            Details here.
          </FormAlert>
        </KitRoot>,
      );
      await expect
        .element(page.getByRole(role).getByText("Heads up"))
        .toBeVisible();
    });
  }

  it("renders no body for a numeric 0 child", async () => {
    await render(
      <KitRoot theme="light">
        <FormAlert tone="info" title="Failed">
          {0}
        </FormAlert>
      </KitRoot>,
    );
    expect(page.getByRole("status").element().textContent).toBe("Failed");
  });

  it("swaps in the offline icon", async () => {
    await render(
      <KitRoot theme="light">
        <FormAlert tone="danger" title="No connection" isOffline />
      </KitRoot>,
    );
    const icon = page.getByRole("alert").element().querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("lucide-wifi-off");
  });
});

describe("AuthFrame", () => {
  it("shows one h1 and the form, footer and brand panel", async () => {
    await render(
      <KitRoot theme="light">
        <AuthFrame title="Welcome back" body="Sign in." footer="Need help?">
          <button type="button">Go</button>
        </AuthFrame>
      </KitRoot>,
    );
    await expect
      .element(page.getByRole("heading", { level: 1, name: "Welcome back" }))
      .toBeVisible();
    await expect.element(page.getByText("Need help?")).toBeVisible();
    expect(document.querySelectorAll("main").length).toBe(1);
    expect(document.querySelectorAll("aside").length).toBe(1);
  });

  it("moves focus to the h1 when the title changes, not on first mount", async () => {
    function Swap() {
      const [isSent, setIsSent] = useState(false);
      return (
        <KitRoot theme="light">
          <AuthFrame
            icon={isSent ? Mail : undefined}
            title={isSent ? "Check your email" : "Forgot password"}
          >
            <button type="button" onClick={() => setIsSent(true)}>
              Send
            </button>
          </AuthFrame>
        </KitRoot>
      );
    }
    await render(<Swap />);
    expect(document.activeElement?.tagName).toBe("BODY");

    await userEvent.click(page.getByRole("button", { name: "Send" }));
    const heading = page.getByRole("heading", { name: "Check your email" });
    await expect.element(heading).toBeVisible();
    expect(document.activeElement).toBe(heading.element());
  });

  it("shows a labelled, text-free skeleton", async () => {
    await render(
      <KitRoot theme="light">
        <AuthFrameSkeleton label="Checking your link" />
      </KitRoot>,
    );
    const status = page.getByRole("status", { name: "Checking your link" });
    await expect.element(status).toBeVisible();
    expect(status.element().textContent).toBe("");
  });

  it("does not scroll sideways at 320px", async () => {
    await page.viewport(320, 700);
    await render(
      <KitRoot theme="light">
        <AuthFrame title="Welcome back" body="Sign in to TutorLink.">
          <PasswordField label="Password" autoComplete="current-password" />
        </AuthFrame>
      </KitRoot>,
    );
    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  });
});

describe("SplashScreen", () => {
  it("is a labelled status with the logo and no text", async () => {
    await render(
      <KitRoot theme="light">
        <SplashScreen />
      </KitRoot>,
    );
    const status = page.getByRole("status", { name: "Checking your session" });
    expect(status.element().textContent).toBe("");
    expect(status.element().querySelector("img")).not.toBeNull();
  });

  it("delays the logo fade by 300ms despite the kit-fade shorthand", async () => {
    await render(
      <KitRoot theme="light">
        <SplashScreen />
      </KitRoot>,
    );
    const fade = page
      .getByRole("status", { name: "Checking your session" })
      .element().firstElementChild as HTMLElement;
    const style = getComputedStyle(fade);
    expect(style.animationDelay).toBe("0.3s");
    expect(style.animationFillMode).toBe("both");
  });
});
