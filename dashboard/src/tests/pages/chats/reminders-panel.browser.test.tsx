import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { App } from "@/App";
import type { Role } from "@/lib/auth/auth";
import type {
  ReminderPreviewItem,
  ReminderRow,
  ReminderWeek,
} from "@/lib/reminders/reminders";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  // The opened thread marks itself read; that request never settles here.
  api: { get: network.get, post: () => new Promise(() => {}) },
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const DEFAULT_WEEK = "2026-10-26";
const PAST_WEEK = "2026-10-19";
const NEXT_RUN = "2026-10-25T21:00:00Z";

const COUNTS = {
  needs_attention: 0,
  time_off_pending: 0,
  children_awaiting_evaluation: 0,
  bookings_to_sort_out: 0,
  children_needing_tutor: 0,
  unread_chats: 0,
};

const item = (
  overrides: Partial<ReminderPreviewItem> = {},
): ReminderPreviewItem => ({
  guardian_id: "g-1",
  guardian_name: "Diana Gómez",
  child_names: ["Emma", "Leo"],
  language: "en",
  skip_reason: null,
  ...overrides,
});

const row = (overrides: Partial<ReminderRow> = {}): ReminderRow => ({
  guardian_id: "g-1",
  guardian_name: "Diana Gómez",
  child_names: ["Emma"],
  language: "en",
  status: "read",
  skip_reason: null,
  error_code: null,
  may_have_been_delivered: false,
  sent_at: "2026-10-18T21:00:00Z",
  ...overrides,
});

const week = (overrides: Partial<ReminderWeek> = {}): ReminderWeek => ({
  week_start: DEFAULT_WEEK,
  has_run: false,
  preview: [],
  rows: [],
  reminders: "on",
  next_run_at: NEXT_RUN,
  ...overrides,
});

type Weeks = Record<string, ReminderWeek>;

const NO_CHATS = { items: [], total: 0, page: 1, page_size: 20 };

function serve(
  weeks: Weeks,
  guardian: (id: string) => Promise<unknown> = async (id) => ({
    id,
    language_conversation_id: "chat-9",
  }),
): void {
  network.get.mockImplementation(
    async (url: string, config?: { params?: { week_start?: string } }) => {
      if (url === "/api/reminders/week") {
        const start = config?.params?.week_start ?? "default";
        const found = weeks[start];
        if (!found) throw new Error("down");
        return { data: found };
      }
      if (url.startsWith("/api/clients/")) {
        return { data: await guardian(url.split("/").pop() ?? "") };
      }
      // These tests stop at the navigation; the opened thread stays loading.
      if (url.startsWith("/api/conversations/")) return new Promise(() => {});
      // The chat list beside an opened thread.
      if (url === "/api/conversations") return { data: NO_CHATS };
      return { data: COUNTS };
    },
  );
}

async function renderAt(path: string, role: Role = "admin"): Promise<void> {
  window.history.pushState({}, "", path);
  useAuthStore.setState({ status: "authenticated", role });
  await renderWithProviders(<App />);
}

const stepperLabel = (text: string) => page.getByText(text, { exact: true });
const earlier = () => page.getByRole("button", { name: "Earlier week" });
const later = () => page.getByRole("button", { name: "Later week" });

beforeEach(async () => {
  await page.viewport(1280, 900);
  network.get.mockReset();
});

describe("status card", () => {
  it("shows the next run and a Settings link to an Admin when on", async () => {
    serve({ default: week() });
    await renderAt("/chats/reminders");
    await expect
      .element(page.getByText("Next Booking reminders: Sun, Oct 25, 5:00 PM"))
      .toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "Change in Settings" }),
    );
    expect(window.location.pathname).toBe("/settings");
  });

  it("says reminders are on without a next run", async () => {
    serve({ default: week({ next_run_at: null }) });
    await renderAt("/chats/reminders");
    await expect.element(page.getByText("Booking reminders are on")).toBeVisible();
  });

  it("offers a primary Turn on in Settings when off", async () => {
    serve({ default: week({ reminders: "off", next_run_at: null }) });
    await renderAt("/chats/reminders");
    await expect
      .element(page.getByText("Booking reminders are off", { exact: true }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Turn on in Settings" }))
      .toBeVisible();
  });

  it("offers Set up in Settings to a Developer when not set up", async () => {
    serve({ default: week({ reminders: "not_set_up", next_run_at: null }) });
    await renderAt("/chats/reminders", "developer");
    await expect
      .element(
        page.getByRole("heading", { name: "Booking reminders aren’t set up" }),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Set up in Settings" }))
      .toBeVisible();
  });

  it("gives a Manager no link, and says only an Admin can change it when not on", async () => {
    serve({ default: week({ reminders: "off", next_run_at: null }) });
    await renderAt("/chats/reminders", "manager");
    await expect
      .element(page.getByText("Only an Admin can change this."))
      .toBeVisible();
    expect(
      page.getByRole("button", { name: /in Settings/ }).elements(),
    ).toHaveLength(0);
  });

  it("gives a Manager no link and no note when on", async () => {
    serve({ default: week() });
    await renderAt("/chats/reminders", "manager");
    await expect
      .element(page.getByText(/Next Booking reminders/))
      .toBeVisible();
    expect(
      page.getByText("Only an Admin can change this.").elements(),
    ).toHaveLength(0);
    expect(
      page.getByRole("button", { name: /in Settings/ }).elements(),
    ).toHaveLength(0);
  });
});

describe("week stepper", () => {
  it("shows Coming up with the week, and disables Later on the default week", async () => {
    serve({ default: week() });
    await renderAt("/chats/reminders");
    await expect.element(stepperLabel("Week of Oct 26")).toBeVisible();
    await expect.element(stepperLabel("Coming up")).toBeVisible();
    await expect.element(later()).toBeDisabled();
    await expect.element(earlier()).toBeEnabled();
  });

  it("steps earlier into ?week= and back to no param", async () => {
    serve({
      default: week(),
      [PAST_WEEK]: week({ week_start: PAST_WEEK, has_run: true, preview: null }),
    });
    await renderAt("/chats/reminders");
    await userEvent.click(earlier());
    expect(window.location.search).toBe(`?week=${PAST_WEEK}`);
    await expect.element(stepperLabel("Week of Oct 19")).toBeVisible();
    await expect.element(stepperLabel("Already sent")).toBeVisible();

    await userEvent.click(later());
    expect(window.location.search).toBe("");
    await expect.element(stepperLabel("Week of Oct 26")).toBeVisible();
  });

  it("treats an invalid ?week= as the default week", async () => {
    serve({ default: week() });
    await renderAt("/chats/reminders?week=2026-10-21");
    await expect.element(stepperLabel("Week of Oct 26")).toBeVisible();
    await expect.element(later()).toBeDisabled();
  });

  it("announces the week politely and swaps the rows for a skeleton while loading", async () => {
    const releases: ((value: ReminderWeek) => void)[] = [];
    serve({ default: week() });
    const base = network.get.getMockImplementation()!;
    network.get.mockImplementation(async (url: string, config?: never) => {
      const params = (config as { params?: { week_start?: string } } | undefined)
        ?.params;
      if (params?.week_start === PAST_WEEK) {
        return {
          data: await new Promise<ReminderWeek>((resolve) => {
            releases.push(resolve);
          }),
        };
      }
      return base(url, config);
    });
    await renderAt("/chats/reminders");
    await expect.element(stepperLabel("Week of Oct 26")).toBeVisible();

    await userEvent.click(earlier());
    await expect.element(stepperLabel("Week of Oct 19")).toBeVisible();
    await expect
      .element(page.getByRole("status", { name: "Loading reminders" }))
      .toBeVisible();
    await expect.element(earlier()).toBeDisabled();
    await expect.element(later()).toBeDisabled();
    // The status card stays while the week loads.
    await expect.element(page.getByText(/Next Booking reminders/)).toBeVisible();
    expect(
      document.querySelector('[aria-live="polite"]')?.textContent,
    ).toContain("Week of Oct 19");

    await vi.waitFor(() => expect(releases.length).toBeGreaterThan(0));
    const loaded = week({ week_start: PAST_WEEK, has_run: true, preview: null });
    releases.forEach((release) => release(loaded));
    await expect
      .element(page.getByText("No reminders went out this week"))
      .toBeVisible();
  });
});

describe("coming week", () => {
  it("explains why nothing goes out when reminders are off", async () => {
    serve({ default: week({ reminders: "off", next_run_at: null }) });
    await renderAt("/chats/reminders");
    await expect
      .element(page.getByText("Nothing will go out this week"))
      .toBeVisible();
    await expect
      .element(page.getByText("Booking reminders are off, so no Guardian gets one."))
      .toBeVisible();
  });

  it("explains it when reminders are not set up", async () => {
    serve({ default: week({ reminders: "not_set_up", next_run_at: null }) });
    await renderAt("/chats/reminders");
    await expect
      .element(
        page.getByText("Booking reminders aren’t set up yet, so no Guardian gets one."),
      )
      .toBeVisible();
  });

  it("says nobody needs a reminder when the preview is empty", async () => {
    serve({ default: week({ preview: [] }) });
    await renderAt("/chats/reminders");
    await expect
      .element(page.getByText("Nobody to remind this week"))
      .toBeVisible();
    await expect
      .element(
        page.getByText("Every Guardian with Reminders on already has a session booked."),
      )
      .toBeVisible();
  });

  it("groups Guardians into will get one and skipped, with the skip reason", async () => {
    serve({
      default: week({
        preview: [
          item(),
          item({
            guardian_id: "g-2",
            guardian_name: "Marco Ruiz",
            child_names: ["Ana"],
            language: "es",
            skip_reason: "template_not_approved",
          }),
        ],
      }),
    });
    await renderAt("/chats/reminders");
    await expect
      .element(page.getByRole("heading", { name: "Will get one · 1" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Skipped · 1" }))
      .toBeVisible();
    await expect.element(page.getByText("Emma, Leo · English")).toBeVisible();
    await expect.element(page.getByText("Ana · Spanish")).toBeVisible();
    await expect
      .element(page.getByRole("button", { name: /Marco Ruiz/ }))
      .toHaveTextContent("Waiting for WhatsApp approval");
  });

  it("shows the empty line for a group with nobody", async () => {
    serve({ default: week({ preview: [item()] }) });
    await renderAt("/chats/reminders");
    await expect.element(page.getByText("Nobody is skipped this week.")).toBeVisible();
  });
});

describe("past week", () => {
  const PAST = week({
    week_start: PAST_WEEK,
    has_run: true,
    preview: null,
    rows: [
      row(),
      row({
        guardian_id: "g-2",
        guardian_name: "Marco Ruiz",
        status: "failed",
        may_have_been_delivered: true,
        sent_at: null,
      }),
    ],
  });

  it("lists the outcomes with their detail and a dash for no send time", async () => {
    await page.viewport(1700, 900);
    serve({ default: week(), [PAST_WEEK]: PAST });
    await renderAt(`/chats/reminders?week=${PAST_WEEK}`);
    const table = page.getByRole("table", {
      name: "Booking reminders, Week of Oct 19",
    });
    await expect.element(table).toBeVisible();
    await expect.element(table.getByText("Read")).toBeVisible();
    await expect.element(table.getByText("May have arrived")).toBeVisible();
    await expect
      .element(
        table.getByText("The send was cut off. Check the chat before sending again."),
      )
      .toBeVisible();
    await expect.element(table.getByText("—")).toBeVisible();
  });

  it("filters to what needs attention, and says when nothing matches", async () => {
    serve({ default: week(), [PAST_WEEK]: PAST });
    await renderAt(`/chats/reminders?week=${PAST_WEEK}`);
    const filter = page.getByRole("button", { name: "Needs attention · 1" });
    await userEvent.click(filter);
    await expect
      .element(page.getByRole("button", { name: "Open Diana Gómez" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Open Marco Ruiz" }))
      .toBeVisible();
  });

  it("shows Nothing matches when the filters leave no rows", async () => {
    serve({
      default: week(),
      [PAST_WEEK]: week({
        week_start: PAST_WEEK,
        has_run: true,
        preview: null,
        rows: [row(), row({ guardian_id: "g-3", status: "failed", error_code: "63024" })],
      }),
    });
    await renderAt(`/chats/reminders?week=${PAST_WEEK}`);
    await userEvent.click(page.getByRole("button", { name: "Needs attention · 1" }));
    await userEvent.click(page.getByRole("button", { name: /Outcome/ }));
    await userEvent.click(page.getByRole("checkbox", { name: "Read" }));
    await expect.element(page.getByText("Nothing matches")).toBeVisible();
    await expect.element(page.getByText("Turn off a filter to see more.")).toBeVisible();
  });

  it("hides the attention filter when nothing needs attention", async () => {
    serve({
      default: week(),
      [PAST_WEEK]: week({
        week_start: PAST_WEEK,
        has_run: true,
        preview: null,
        rows: [row()],
      }),
    });
    await renderAt(`/chats/reminders?week=${PAST_WEEK}`);
    await expect.element(page.getByRole("button", { name: /Outcome/ })).toBeVisible();
    expect(
      page.getByRole("button", { name: /Needs attention/ }).elements(),
    ).toHaveLength(0);
  });

  it("says nothing went out when the run has no rows", async () => {
    serve({
      default: week(),
      [PAST_WEEK]: week({ week_start: PAST_WEEK, has_run: true, preview: null }),
    });
    await renderAt(`/chats/reminders?week=${PAST_WEEK}`);
    await expect
      .element(page.getByText("No reminders went out this week"))
      .toBeVisible();
    await expect
      .element(
        page.getByText("Everyone with Reminders on had a session booked, or reminders were off."),
      )
      .toBeVisible();
  });
});

describe("an earlier week that never ran", () => {
  it("reads as nothing sent, not as a preview, when reminders are off", async () => {
    serve({
      default: week({ reminders: "off", next_run_at: null }),
      [PAST_WEEK]: week({
        week_start: PAST_WEEK,
        has_run: false,
        preview: null,
        reminders: "off",
        next_run_at: null,
      }),
    });
    await renderAt(`/chats/reminders?week=${PAST_WEEK}`);
    await expect
      .element(page.getByText("No reminders went out this week"))
      .toBeVisible();
    await expect.element(stepperLabel("Already sent")).toBeVisible();
  });
});

describe("opening a Guardian's chat from a past week", () => {
  it("marks the table row busy while the Guardian loads", async () => {
    let release: (value: unknown) => void = () => {};
    serve(
      {
        default: week(),
        [PAST_WEEK]: week({
          week_start: PAST_WEEK,
          has_run: true,
          preview: null,
          rows: [row()],
        }),
      },
      () => new Promise((resolve) => (release = resolve)),
    );
    await renderAt(`/chats/reminders?week=${PAST_WEEK}`);
    const open = page.getByRole("button", { name: "Open Diana Gómez" });
    await userEvent.click(open);
    await expect.element(open).toHaveAttribute("aria-busy", "true");
    release({ id: "g-1", language_conversation_id: "chat-9" });
    await vi.waitFor(() => expect(window.location.pathname).toBe("/chats/chat-9"));
  });
});

describe("opening a Guardian's chat", () => {
  const PREVIEW = week({ preview: [item()] });

  it("goes to the language chat", async () => {
    serve({ default: PREVIEW });
    await renderAt("/chats/reminders");
    await userEvent.click(page.getByRole("button", { name: /Diana Gómez/ }));
    await vi.waitFor(() => expect(window.location.pathname).toBe("/chats/chat-9"));
  });

  it("shows a busy row while the Guardian loads", async () => {
    let release: (value: unknown) => void = () => {};
    serve(
      { default: PREVIEW },
      () => new Promise((resolve) => (release = resolve)),
    );
    await renderAt("/chats/reminders");
    const rowButton = page.getByRole("button", { name: /Diana Gómez/ });
    await userEvent.click(rowButton);
    await expect.element(rowButton).toHaveAttribute("aria-busy", "true");
    release({ id: "g-1", language_conversation_id: "chat-9" });
    await vi.waitFor(() => expect(window.location.pathname).toBe("/chats/chat-9"));
  });

  it("says so when the Guardian has no chat yet", async () => {
    serve(
      { default: PREVIEW },
      async (id) => ({ id, language_conversation_id: null }),
    );
    await renderAt("/chats/reminders");
    await userEvent.click(page.getByRole("button", { name: /Diana Gómez/ }));
    await expect.element(page.getByText("Diana Gómez has no chat yet.")).toBeVisible();
    expect(window.location.pathname).toBe("/chats/reminders");
  });

  it("shows an error toast when the Guardian can't be read", async () => {
    serve({ default: PREVIEW }, async () => {
      throw new Error("down");
    });
    await renderAt("/chats/reminders");
    await userEvent.click(page.getByRole("button", { name: /Diana Gómez/ }));
    await expect
      .element(page.getByText("Couldn’t open Diana Gómez’s chat. Try again."))
      .toBeVisible();
  });
});

describe("loading and errors", () => {
  it("shows a skeleton while the first load runs", async () => {
    network.get.mockImplementation(async (url: string) => {
      if (url === "/api/reminders/week") return new Promise(() => {});
      return { data: COUNTS };
    });
    await renderAt("/chats/reminders");
    await expect
      .element(page.getByRole("status", { name: "Loading reminders" }))
      .toBeVisible();
    await expect.element(earlier()).toBeDisabled();
  });

  it("shows an error with Try again that loads the week", async () => {
    serve({});
    await renderAt("/chats/reminders");
    await expect.element(page.getByText("Couldn’t load reminders")).toBeVisible();
    await expect
      .element(page.getByText("Check your connection and try again."))
      .toBeVisible();

    serve({ default: week() });
    await userEvent.click(page.getByRole("button", { name: "Try again" }));
    await expect.element(page.getByText("Week of Oct 26", { exact: true })).toBeVisible();
  });
});
