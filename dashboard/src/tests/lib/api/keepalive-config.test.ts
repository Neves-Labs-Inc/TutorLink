import { afterEach, describe, expect, it, vi } from "vitest";
import { api, getKeepaliveConfig } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

const ACCESS_TOKEN = "header.payload.signature";
// Node's Request needs an absolute URL; the browser resolves a relative one.
const NODE_BASE_URL = "http://localhost";

describe("getKeepaliveConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.setState({ accessToken: null });
  });

  it("leaves a normal request alone", () => {
    expect(getKeepaliveConfig(false)).toEqual({});
  });

  it("sends through fetch with keepalive", () => {
    expect(getKeepaliveConfig(true)).toEqual({
      adapter: "fetch",
      fetchOptions: { keepalive: true },
    });
  });

  it("keeps the bearer token on a keepalive request", async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchSpy);
    useAuthStore.setState({ accessToken: ACCESS_TOKEN });

    await api.post("/api/ping", {}, {
      ...getKeepaliveConfig(true),
      baseURL: NODE_BASE_URL,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    // The fetch adapter hands fetch a built Request.
    const [request] = fetchSpy.mock.calls[0] as unknown as [Request];
    expect(request.keepalive).toBe(true);
    expect(request.headers.get("Authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
  });
});
