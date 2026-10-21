import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import { useDeferredAction } from "@/components/kit/overlays/use-deferred-action";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const ACCESS_TOKEN = "header.payload.signature";

const network = vi.hoisted(() => ({
  events: [] as string[],
  requestLogout: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requestLogout: network.requestLogout,
}));

// Approves something, then offers Sign out, as the app would.
function Harness({
  commit,
}: {
  commit: (options: { keepalive: boolean }) => Promise<unknown>;
}): ReactNode {
  const { defer } = useDeferredAction();
  const { logout } = useAuth();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          defer({
            message: "Approved Bruno’s time off.",
            commit,
            onUndo: () => undefined,
            errorMessage: "Couldn’t approve Bruno’s time off. Try again.",
          })
        }
      >
        Approve
      </button>
      <button type="button" onClick={logout}>
        Sign out
      </button>
    </>
  );
}

// Like the app shell, the kit is only mounted while signed in.
function SignedInKit({ children }: { children: ReactNode }): ReactNode {
  const accessToken = useAuthStore((state) => state.accessToken);
  if (accessToken === null) return null;
  return (
    <KitRoot theme="light" height="600px">
      {children}
    </KitRoot>
  );
}

async function renderHarness(
  commit: (options: { keepalive: boolean }) => Promise<unknown>,
): Promise<void> {
  await renderWithProviders(
    <MemoryRouter>
      <SignedInKit>
        <Harness commit={commit} />
      </SignedInKit>
    </MemoryRouter>,
  );
}

describe("signing out with an act pending", () => {
  afterEach(() => {
    network.events.length = 0;
    network.requestLogout.mockReset();
    useAuthStore.setState({ accessToken: null });
  });

  it("sends the act with the token before the session clears", async () => {
    useAuthStore.setState({ status: "authenticated", accessToken: ACCESS_TOKEN });
    network.requestLogout.mockImplementation(async () => {
      network.events.push("logout");
    });
    const commit = vi.fn(async () => {
      network.events.push(`commit:${useAuthStore.getState().accessToken}`);
    });
    await renderHarness(commit);
    await userEvent.click(page.getByRole("button", { name: "Approve" }));

    await userEvent.click(page.getByRole("button", { name: "Sign out" }));

    await expect.poll(() => useAuthStore.getState().accessToken).toBeNull();
    expect(commit).toHaveBeenCalledExactlyOnceWith({ keepalive: true });
    expect(network.events).toEqual([`commit:${ACCESS_TOKEN}`, "logout"]);
  });

  it("drops an act approved while the logout call is in flight", async () => {
    useAuthStore.setState({ status: "authenticated", accessToken: ACCESS_TOKEN });
    let finishLogout = () => {};
    network.requestLogout.mockImplementation(
      () => new Promise<void>((resolve) => (finishLogout = resolve)),
    );
    const commit = vi.fn(async () => undefined);
    await renderHarness(commit);
    await userEvent.click(page.getByRole("button", { name: "Sign out" }));
    await expect.poll(() => network.requestLogout).toHaveBeenCalledOnce();

    await userEvent.click(page.getByRole("button", { name: "Approve" }));
    finishLogout();

    await expect.poll(() => useAuthStore.getState().accessToken).toBeNull();
    // The session cleared first, so sending now would go out with no token.
    expect(commit).not.toHaveBeenCalled();
  });
});
