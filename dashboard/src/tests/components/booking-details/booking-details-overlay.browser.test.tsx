import { useState } from "react";
import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import BookingDetailsOverlay from "@/components/booking-details/booking-details-overlay";
import type { Role } from "@/lib/auth/auth";
import type { BookingDetail } from "@/lib/queries/bookings";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const network = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: {
    get: network.get,
    patch: network.patch,
    post: network.post,
    delete: network.delete,
  },
}));

const BOOKING_ID = "b-1";
const BOOKING_URL = `/api/bookings/${BOOKING_ID}`;
const READ_AT = "2026-10-20T14:00:00Z";
const WRITTEN_AT = "2026-10-21T09:00:00Z";
const PAST_DAY = "2020-03-05";
const FUTURE_DAY = "2099-03-05";

function makeBooking(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: BOOKING_ID,
    child: { id: "c-9", name: "Emma Souza", notes: null },
    staff: { id: "u-2", name: "Ana Lima", role: "tutor" },
    kind: "regular",
    location: "home",
    subject: { id: "s-1", name: "Math" },
    subject_level: 5,
    scheduled_date: FUTURE_DAY,
    start_time: "15:30:00",
    end_time: "16:30:00",
    status: "confirmed",
    notes: null,
    updated_at: READ_AT,
    office_address: null,
    home: {
      id: "h-1",
      label: "Main",
      address: "12 Oak St",
      directions: "Blue gate",
      access_code: "1234",
    },
    booked_by_guardian: null,
    guardians: [
      { id: "g-1", name: "Diana Souza", conversation_id: "conv-1" },
      { id: "g-2", name: "Paulo Souza", conversation_id: null },
    ],
    availability_id: null,
    clashing_time_off: [],
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    created_at: "2026-10-08T18:14:00Z",
    ...overrides,
  };
}

function apiError(status: number, data: object): AxiosError {
  const response: AxiosResponse = {
    data,
    status,
    statusText: "",
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return new AxiosError("failed", String(status), undefined, undefined, response);
}

function serve(booking: BookingDetail): void {
  network.get.mockImplementation((url: string) =>
    url === BOOKING_URL
      ? Promise.resolve({ data: booking })
      : Promise.reject(new Error(`unexpected GET ${url}`)),
  );
}

function statusChanged(status: string) {
  return {
    data: {
      id: BOOKING_ID,
      status,
      scheduled_date: FUTURE_DAY,
      start_time: "15:30:00",
      end_time: "16:30:00",
      updated_at: WRITTEN_AT,
    },
  };
}

const onChangeBooking = vi.fn();

function Harness(): ReactNode {
  const [bookingId, setBookingId] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setBookingId(BOOKING_ID)}>
        Open booking
      </button>
      <BookingDetailsOverlay
        bookingId={bookingId}
        backLabel="Bookings"
        onClose={() => setBookingId(null)}
        onChangeBooking={onChangeBooking}
      />
    </>
  );
}

function ChatPage(): ReactNode {
  const { conversationId } = useParams();
  return <p>Chat {conversationId}</p>;
}

async function openDetails(booking: BookingDetail | null = makeBooking()) {
  if (booking) serve(booking);
  await renderWithProviders(
    <MemoryRouter>
      <KitRoot theme="light">
        <Routes>
          <Route path="/" element={<Harness />} />
          <Route path="/chats/:conversationId" element={<ChatPage />} />
          <Route path="/families/:memberId" element={<p>Family page</p>} />
        </Routes>
      </KitRoot>
    </MemoryRouter>,
  );
  await userEvent.click(page.getByRole("button", { name: "Open booking" }));
}

const details = () => page.getByRole("dialog");
const footerButtonNames = () =>
  [...document.querySelectorAll("[role=dialog] button")]
    .map((button) => button.textContent?.trim() ?? "")
    .filter((name) =>
      [
        "Completed",
        "Didn’t happen",
        "Change booking",
        "Keep booking",
        "Cancel booking",
        "Re-open",
        "Restore",
        "Restore anyway",
      ].includes(name),
    );

function signInAs(role: Role): void {
  useAuthStore.setState({ status: "authenticated", role });
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  for (const mock of Object.values(network)) mock.mockReset();
  onChangeBooking.mockReset();
  signInAs("admin");
});

describe("buttons by state", () => {
  const cases: [string, Partial<BookingDetail>, string[], string[]][] = [
    [
      "Confirmed and started",
      { scheduled_date: PAST_DAY },
      ["Completed", "Didn’t happen"],
      ["Completed", "Didn’t happen"],
    ],
    // The API never moves Pending to Completed.
    [
      "Pending and started",
      { scheduled_date: PAST_DAY, status: "pending" },
      ["Didn’t happen"],
      ["Didn’t happen"],
    ],
    [
      "Pending and not marked",
      {
        scheduled_date: PAST_DAY,
        status: "pending",
        sort_out_reasons: ["not_completed"],
      },
      ["Didn’t happen"],
      ["Didn’t happen"],
    ],
    [
      "a Time off clash",
      { sort_out_reasons: ["time_off_clash"] },
      ["Change booking", "Keep booking"],
      ["Change booking"],
    ],
    [
      "archived Staff",
      { sort_out_reasons: ["archived_staff"] },
      ["Change booking", "Cancel booking"],
      ["Change booking", "Cancel booking"],
    ],
    [
      "live and upcoming",
      {},
      ["Change booking", "Cancel booking"],
      ["Change booking", "Cancel booking"],
    ],
    [
      "Completed",
      { scheduled_date: PAST_DAY, status: "completed" },
      ["Re-open"],
      ["Re-open"],
    ],
    [
      "Didn't happen",
      { scheduled_date: PAST_DAY, status: "didnt_happen" },
      ["Re-open"],
      ["Re-open"],
    ],
    ["future Cancelled", { status: "cancelled" }, ["Restore"], ["Restore"]],
    [
      "past Cancelled",
      { scheduled_date: PAST_DAY, status: "cancelled" },
      [],
      [],
    ],
  ];

  for (const [name, overrides, adminButtons, managerButtons] of cases) {
    it(`shows exactly its buttons when ${name}, for an Admin`, async () => {
      await openDetails(makeBooking(overrides));
      await expect.element(details().getByText("Emma Souza")).toBeVisible();
      expect(footerButtonNames()).toEqual(adminButtons);
    });

    it(`shows exactly its buttons when ${name}, for a Manager`, async () => {
      signInAs("manager");
      await openDetails(makeBooking(overrides));
      await expect.element(details().getByText("Emma Souza")).toBeVisible();
      expect(footerButtonNames()).toEqual(managerButtons);
    });
  }

  it("says a past Cancelled booking can't be changed", async () => {
    await openDetails(
      makeBooking({ scheduled_date: PAST_DAY, status: "cancelled" }),
    );
    await expect
      .element(page.getByText("Cancelled bookings can’t be changed."))
      .toBeVisible();
  });

  it("hands the Booking to Change booking", async () => {
    await openDetails();
    await userEvent.click(page.getByRole("button", { name: "Change booking" }));
    expect(onChangeBooking).toHaveBeenCalledWith(
      expect.objectContaining({ id: BOOKING_ID }),
    );
  });
});

describe("Needs attention", () => {
  it("shows a callout per reason and the first reason's buttons", async () => {
    await openDetails(
      makeBooking({
        scheduled_date: PAST_DAY,
        sort_out_reasons: ["not_completed", "time_off_clash"],
        clashing_time_off: [
          {
            id: "t-1",
            start_date: "2020-03-04",
            end_date: "2020-03-06",
            start_time: null,
            end_time: null,
          },
        ],
      }),
    );
    const callouts = page.getByRole("region", { name: "Needs attention" });
    await expect
      .element(callouts.getByText("Its date has passed and nobody has marked it."))
      .toBeVisible();
    await expect
      .element(
        callouts.getByText("Ana Lima has approved Time off then.", {
          exact: false,
        }),
      )
      .toBeVisible();
    await expect
      .element(callouts.getByText("Time off: Wed, Mar 4 – Fri, Mar 6"))
      .toBeVisible();
    expect(footerButtonNames()).toEqual(["Completed", "Didn’t happen"]);
  });

  it("names archived Staff", async () => {
    await openDetails(makeBooking({ sort_out_reasons: ["archived_staff"] }));
    await expect
      .element(
        page.getByText(
          "Ana Lima is archived. Give the booking to someone else, or cancel it.",
        ),
      )
      .toBeVisible();
  });

  it("tells a Manager only an Admin can keep a booking over Time off", async () => {
    signInAs("manager");
    await openDetails(makeBooking({ sort_out_reasons: ["time_off_clash"] }));
    await expect
      .element(page.getByText("Only an Admin can keep a booking over Time off."))
      .toBeVisible();
  });
});

describe("marks and keep", () => {
  const marks: [string, string, string][] = [
    ["Completed", "completed", "Marked Completed: Emma Souza, Thu, Mar 5 at 3:30 PM."],
    [
      "Didn’t happen",
      "didnt_happen",
      "Marked Didn’t happen: Emma Souza, Thu, Mar 5 at 3:30 PM.",
    ],
  ];

  for (const [button, status, toast] of marks) {
    it(`marks it ${button}, closes, and Undo puts it back to confirmed`, async () => {
      network.patch.mockResolvedValue(statusChanged(status));
      await openDetails(makeBooking({ scheduled_date: PAST_DAY }));
      await userEvent.click(page.getByRole("button", { name: button }));

      await expect.element(page.getByText(toast)).toBeVisible();
      expect(network.patch).toHaveBeenCalledWith(BOOKING_URL, {
        status,
        expected_updated_at: READ_AT,
      });
      await expect.element(details()).not.toBeInTheDocument();

      network.patch.mockResolvedValue(statusChanged("confirmed"));
      await userEvent.click(page.getByRole("button", { name: "Undo" }));
      await vi.waitFor(() =>
        expect(network.patch).toHaveBeenLastCalledWith(BOOKING_URL, {
          status: "confirmed",
          expected_updated_at: WRITTEN_AT,
        }),
      );
    });
  }

  it("keeps a booking over Time off, and Undo stops keeping it", async () => {
    network.post.mockResolvedValue({ data: makeBooking() });
    network.delete.mockResolvedValue({ data: makeBooking() });
    await openDetails(makeBooking({ sort_out_reasons: ["time_off_clash"] }));
    await userEvent.click(page.getByRole("button", { name: "Keep booking" }));

    await expect
      .element(page.getByText("Kept over Time off: Emma Souza, Thu, Mar 5 at 3:30 PM."))
      .toBeVisible();
    expect(network.post).toHaveBeenCalledWith(
      `${BOOKING_URL}/clash-acknowledgement`,
    );
    await expect.element(details()).not.toBeInTheDocument();

    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() =>
      expect(network.delete).toHaveBeenCalledWith(
        `${BOOKING_URL}/clash-acknowledgement`,
      ),
    );
  });

  it("says when an Undo didn't happen", async () => {
    network.patch.mockResolvedValueOnce(statusChanged("completed"));
    await openDetails(makeBooking({ scheduled_date: PAST_DAY }));
    await userEvent.click(page.getByRole("button", { name: "Completed" }));
    network.patch.mockRejectedValueOnce(
      apiError(409, { detail: "That booking changed since it was picked" }),
    );
    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await expect
      .element(page.getByText("Couldn’t undo. The booking has changed since."))
      .toBeVisible();
  });

  it("shows a failed mark by the buttons and stays open", async () => {
    network.patch.mockRejectedValue(new Error("offline"));
    await openDetails(makeBooking({ scheduled_date: PAST_DAY }));
    await userEvent.click(page.getByRole("button", { name: "Completed" }));
    await expect
      .element(details().getByRole("alert"))
      .toHaveTextContent("Couldn’t mark it Completed. Try again.");
  });
});

describe("Re-open and Stop keeping", () => {
  it("re-opens in place, focuses the title, and Undo restores the status", async () => {
    const completed = makeBooking({
      scheduled_date: PAST_DAY,
      status: "completed",
    });
    network.patch.mockResolvedValue(statusChanged("confirmed"));
    await openDetails(completed);
    serve({ ...completed, status: "confirmed", updated_at: WRITTEN_AT });
    await userEvent.click(page.getByRole("button", { name: "Re-open" }));

    await expect
      .element(page.getByText("Re-opened: Emma Souza, Thu, Mar 5 at 3:30 PM."))
      .toBeVisible();
    expect(network.patch).toHaveBeenCalledWith(BOOKING_URL, {
      status: "confirmed",
      expected_updated_at: READ_AT,
    });
    await expect
      .element(page.getByRole("button", { name: "Completed" }))
      .toBeVisible();
    expect(document.activeElement?.tagName).toBe("H2");

    await userEvent.click(page.getByRole("button", { name: "Undo" }));
    await vi.waitFor(() =>
      expect(network.patch).toHaveBeenLastCalledWith(BOOKING_URL, {
        status: "completed",
        expected_updated_at: WRITTEN_AT,
      }),
    );
  });

  it("shows who kept it, and lets an Admin stop keeping it", async () => {
    network.delete.mockResolvedValue({ data: makeBooking() });
    await openDetails(
      makeBooking({
        clash_acknowledged_at: "2026-10-14T15:00:00Z",
        clash_acknowledged_by: { id: "u-1", name: "Maria Lopes" },
        clashing_time_off: [
          {
            id: "t-1",
            start_date: FUTURE_DAY,
            end_date: FUTURE_DAY,
            start_time: null,
            end_time: null,
          },
        ],
      }),
    );
    await expect
      .element(page.getByText("Kept over Ana’s Time off by Maria Lopes, Oct 14"))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Stop keeping" }));
    await expect
      .element(
        page.getByText("No longer kept. The Time off clash needs attention again."),
      )
      .toBeVisible();
    expect(network.delete).toHaveBeenCalledWith(
      `${BOOKING_URL}/clash-acknowledgement`,
    );
  });

  it("doesn't offer Stop keeping to a Manager", async () => {
    signInAs("manager");
    await openDetails(
      makeBooking({
        clash_acknowledged_at: "2026-10-14T15:00:00Z",
        clash_acknowledged_by: { id: "u-1", name: "Maria Lopes" },
        clashing_time_off: [
          {
            id: "t-1",
            start_date: FUTURE_DAY,
            end_date: FUTURE_DAY,
            start_time: null,
            end_time: null,
          },
        ],
      }),
    );
    await expect
      .element(page.getByText("Kept over Ana’s Time off by Maria Lopes, Oct 14"))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Stop keeping" }))
      .not.toBeInTheDocument();
  });
});

describe("Cancel booking", () => {
  it("asks first, and Keep booking sends nothing", async () => {
    await openDetails();
    await userEvent.click(page.getByRole("button", { name: "Cancel booking" }));
    const dialog = page.getByRole("alertdialog", { name: "Cancel this booking?" });
    await expect
      .element(dialog)
      .toHaveTextContent(
        "Emma Souza with Ana Lima, Thu, Mar 5 at 3:30 PM. TutorLink doesn’t message the Guardian: let Diana know yourself.",
      );
    await userEvent.click(dialog.getByRole("button", { name: "Keep booking" }));
    await expect.element(dialog).not.toBeInTheDocument();
    expect(network.patch).not.toHaveBeenCalled();
  });

  it("cancels on confirm, closes, and offers the booker's chat", async () => {
    network.patch.mockResolvedValue(statusChanged("cancelled"));
    await openDetails(
      makeBooking({
        booked_by_guardian: { id: "g-2", name: "Paulo Souza" },
      }),
    );
    await userEvent.click(page.getByRole("button", { name: "Cancel booking" }));
    const dialog = page.getByRole("alertdialog");
    await userEvent.click(dialog.getByRole("button", { name: "Cancel booking" }));

    await expect
      .element(page.getByText("Booking cancelled. Let Paulo know."))
      .toBeVisible();
    expect(network.patch).toHaveBeenCalledWith(BOOKING_URL, {
      status: "cancelled",
      expected_updated_at: READ_AT,
    });
    await expect.element(details()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Open booking" }))
      .toHaveFocus();
    // Paulo has no chat, so it opens the first Guardian's that has one.
    await userEvent.click(page.getByRole("button", { name: "Open chat" }));
    await expect.element(page.getByText("Chat conv-1")).toBeVisible();
  });

  it("offers no chat when no Guardian has one", async () => {
    network.patch.mockResolvedValue(statusChanged("cancelled"));
    await openDetails(
      makeBooking({
        guardians: [{ id: "g-1", name: "Diana Souza", conversation_id: null }],
      }),
    );
    await userEvent.click(page.getByRole("button", { name: "Cancel booking" }));
    await userEvent.click(
      page.getByRole("alertdialog").getByRole("button", { name: "Cancel booking" }),
    );
    await expect
      .element(page.getByText("Booking cancelled. Let Diana know."))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Open chat" }))
      .not.toBeInTheDocument();
  });
});

describe("Restore", () => {
  const cancelled = () => makeBooking({ status: "cancelled" });

  it("shows warnings and resends with confirm_warnings on Restore anyway", async () => {
    network.patch.mockRejectedValueOnce(
      apiError(409, {
        detail: "Confirm the warnings",
        warnings: [
          { code: "gap", message: "Ana has another booking just before." },
        ],
      }),
    );
    await openDetails(cancelled());
    await userEvent.click(page.getByRole("button", { name: "Restore" }));

    await expect.element(page.getByText("Check before you restore")).toBeVisible();
    await expect
      .element(page.getByText("Ana has another booking just before."))
      .toBeVisible();

    network.patch.mockResolvedValueOnce(statusChanged("confirmed"));
    await userEvent.click(page.getByRole("button", { name: "Restore anyway" }));
    await expect
      .element(page.getByText("Booking restored. Let Diana know."))
      .toBeVisible();
    expect(network.patch).toHaveBeenLastCalledWith(BOOKING_URL, {
      status: "confirmed",
      expected_updated_at: READ_AT,
      confirm_warnings: ["gap"],
    });
    await expect
      .element(page.getByText("Check before you restore"))
      .not.toBeInTheDocument();
  });

  const refusals: [string, AxiosError, string][] = [
    [
      "an overlap",
      apiError(409, {
        detail: "Reverting would overlap another live booking of this Staff member",
      }),
      "Can’t restore: Ana has another booking at that time.",
    ],
    [
      "an archived Child",
      apiError(409, { detail: "Restore the Child first" }),
      "Can’t restore: Emma is archived.",
    ],
    [
      "archived Staff",
      apiError(409, { detail: "This Staff member is archived" }),
      "Can’t restore: Ana is archived.",
    ],
  ];

  for (const [name, error, message] of refusals) {
    it(`shows the refusal for ${name} inline`, async () => {
      network.patch.mockRejectedValue(error);
      await openDetails(cancelled());
      await userEvent.click(page.getByRole("button", { name: "Restore" }));
      await expect.element(details().getByRole("alert")).toHaveTextContent(message);
    });
  }
});

describe("stale writes", () => {
  it("says someone else changed it and reloads it", async () => {
    network.patch.mockRejectedValue(
      apiError(409, { detail: "That booking changed since it was picked" }),
    );
    await openDetails(makeBooking({ scheduled_date: PAST_DAY }));
    expect(network.get).toHaveBeenCalledTimes(1);
    await userEvent.click(page.getByRole("button", { name: "Didn’t happen" }));

    await expect
      .element(details().getByRole("alert"))
      .toHaveTextContent("Someone else changed this booking. It’s been reloaded.");
    await vi.waitFor(() => expect(network.get).toHaveBeenCalledTimes(2));
  });
});

describe("what it shows", () => {
  it("links the Child to their family page", async () => {
    await openDetails();
    await expect
      .element(details().getByRole("link", { name: "Emma Souza" }))
      .toHaveAttribute("href", "/families/c-9?child=c-9");
  });

  it("renders notes as text, never HTML", async () => {
    await openDetails(
      makeBooking({
        notes: "<b>Bring</b> the workbook",
        child: { id: "c-9", name: "Emma Souza", notes: "<img src=x>" },
      }),
    );
    await expect
      .element(page.getByText("<b>Bring</b> the workbook"))
      .toBeVisible();
    await expect.element(page.getByText("<img src=x>")).toBeVisible();
    expect(document.querySelector("[role=dialog] b")).toBeNull();
  });

  it("shows the location, Guardians and who booked it", async () => {
    await openDetails();
    const dialog = details();
    await expect.element(dialog.getByText("Main home")).toBeVisible();
    await expect.element(dialog.getByText("Directions: Blue gate")).toBeVisible();
    await expect.element(dialog.getByText("No chat yet")).toBeVisible();
    await expect
      .element(dialog.getByText("By the office · Thu, Oct 8, 2:14 PM"))
      .toBeVisible();
    await expect.element(dialog.getByText("Math: Grade 5")).toBeVisible();
  });

  it("shows In office with the office address", async () => {
    await openDetails(
      makeBooking({ home: null, location: "in_office", office_address: "1 Main St" }),
    );
    await expect.element(details().getByText("In office")).toBeVisible();
    await expect.element(details().getByText("1 Main St")).toBeVisible();
  });
});

describe("loading and failures to load", () => {
  it("shows a skeleton while it loads", async () => {
    network.get.mockReturnValue(new Promise(() => {}));
    await openDetails(null);
    await expect
      .element(page.getByRole("status", { name: "Loading booking" }))
      .toBeVisible();
  });

  it("offers Try again when it can't load", async () => {
    network.get.mockRejectedValueOnce(new Error("offline"));
    await openDetails(null);
    await expect
      .element(
        page.getByText(
          "Couldn’t load this booking. Check your connection and try again.",
        ),
      )
      .toBeVisible();
    serve(makeBooking());
    await userEvent.click(page.getByRole("button", { name: "Try again" }));
    await expect.element(details().getByText("Emma Souza")).toBeVisible();
  });

  it("says when the booking doesn't exist", async () => {
    network.get.mockRejectedValue(apiError(404, { detail: "Booking not found" }));
    await openDetails(null);
    await expect
      .element(page.getByText("This booking doesn’t exist any more"))
      .toBeVisible();
  });
});

describe("focus", () => {
  it("returns to the opener on close", async () => {
    await openDetails();
    await expect.element(details().getByText("Emma Souza")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(details()).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Open booking" }))
      .toHaveFocus();
  });
});

describe("acts in flight", () => {
  it("busies the pressed button and disables the others", async () => {
    network.patch.mockReturnValue(new Promise(() => {}));
    await openDetails(makeBooking({ scheduled_date: PAST_DAY }));
    await userEvent.click(page.getByRole("button", { name: "Completed" }));
    await expect
      .element(page.getByRole("button", { name: "Completed" }))
      .toHaveAttribute("aria-busy", "true");
    await expect
      .element(page.getByRole("button", { name: "Didn’t happen" }))
      .toBeDisabled();
  });

  it("toasts a failure that lands after the details closed", async () => {
    let fail: (error: unknown) => void = () => {};
    network.patch.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    await openDetails(makeBooking({ scheduled_date: PAST_DAY }));
    await userEvent.click(page.getByRole("button", { name: "Completed" }));
    await userEvent.keyboard("{Escape}");
    await expect.element(details()).not.toBeInTheDocument();
    fail(new Error("offline"));
    await expect
      .element(
        page.getByText(
          "Couldn’t mark Emma’s booking Completed. Open it and try again.",
        ),
      )
      .toBeVisible();
  });
});

describe("on a phone", () => {
  it("is a pushed page with a back link named by the host", async () => {
    await page.viewport(375, 812);
    await openDetails();
    await userEvent.click(page.getByRole("button", { name: "Bookings" }));
    await expect.element(details()).not.toBeInTheDocument();
  });
});

describe("round 2", () => {
  it("shows the re-opened state at once, so the next act sends the new updated_at", async () => {
    const completed = makeBooking({
      scheduled_date: PAST_DAY,
      status: "completed",
    });
    network.patch.mockResolvedValue(statusChanged("confirmed"));
    await openDetails(completed);
    // The refetch never lands: the footer must come from the write's answer.
    network.get.mockReturnValue(new Promise(() => {}));
    await userEvent.click(page.getByRole("button", { name: "Re-open" }));
    await expect
      .element(page.getByRole("button", { name: "Didn’t happen" }))
      .toBeVisible();

    // The Re-open toast sits over the footer's corner on desktop; the
    // user clears it before the next act, or the click waits out its 8s.
    await userEvent.click(page.getByRole("button", { name: "Dismiss" }));
    network.patch.mockResolvedValue(statusChanged("didnt_happen"));
    await userEvent.click(page.getByRole("button", { name: "Didn’t happen" }));
    await vi.waitFor(() =>
      expect(network.patch).toHaveBeenLastCalledWith(BOOKING_URL, {
        status: "didnt_happen",
        expected_updated_at: WRITTEN_AT,
      }),
    );
  });

  it("drops the restore warnings when Restore anyway is refused", async () => {
    network.patch.mockRejectedValueOnce(
      apiError(409, {
        detail: "Confirm the warnings",
        warnings: [{ code: "gap", message: "Ana has another booking just before." }],
      }),
    );
    await openDetails(makeBooking({ status: "cancelled" }));
    await userEvent.click(page.getByRole("button", { name: "Restore" }));
    await expect.element(page.getByText("Check before you restore")).toBeVisible();

    network.patch.mockRejectedValueOnce(
      apiError(409, { detail: "Restore the Child first" }),
    );
    await userEvent.click(page.getByRole("button", { name: "Restore anyway" }));
    await expect
      .element(details().getByRole("alert"))
      .toHaveTextContent("Can’t restore: Emma is archived.");
    await expect
      .element(page.getByText("Check before you restore"))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Restore" })).toBeVisible();
  });
});
