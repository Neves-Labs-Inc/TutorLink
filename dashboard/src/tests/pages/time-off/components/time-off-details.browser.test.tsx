import { useState } from "react";
import type { ReactNode } from "react";
import { queryOptions } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type { AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import type { ExceptionRead } from "@/lib/queries/time-off";
import TimeOffDetails from "@/pages/time-off/components/time-off-details";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";
import { renderWithProviders } from "@/test/render-with-providers";

const network = vi.hoisted(() => ({ detail: vi.fn(), cancel: vi.fn() }));

vi.mock("@/lib/queries/time-off", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/time-off")>();
  return {
    ...actual,
    timeOffQueries: {
      ...actual.timeOffQueries,
      detail: (id: string) =>
        queryOptions({
          ...actual.timeOffQueries.detail(id),
          queryFn: () => network.detail(id),
        }),
    },
    timeOffMutations: {
      ...actual.timeOffMutations,
      cancel: () => ({
        ...actual.timeOffMutations.cancel(),
        mutationFn: (id: string) => network.cancel(id),
      }),
    },
  };
});

const DESKTOP = 1280;
const PHONE = 390;
const NARROWEST = 320;
const HEIGHT = 800;
const SLIDE_OVER_WIDTH = 440;

const MARCO = { id: "u-tutor", name: "Marco Bell" };
const RITA = { id: "u-admin", name: "Rita Souza" };
const TUTOR: Viewer = { id: MARCO.id, role: "tutor" };
const ADMIN: Viewer = { id: RITA.id, role: "admin" };
const MANAGER: Viewer = { id: "u-manager", role: "manager" };

// 19:10 UTC is 3:10 PM in New York; 2031-10-20 is a Monday, far ahead.
const ASKED = "2031-10-14T19:10:00Z";
const DECIDED = "2031-10-15T13:00:00Z";

const PENDING: ExceptionRead = {
  id: "to-1",
  staff: { ...MARCO, role: "tutor" },
  start_date: "2031-10-20",
  end_date: "2031-10-22",
  start_time: null,
  end_time: null,
  reason: "Family trip",
  status: "pending",
  created_at: ASKED,
  decided_by: null,
  decided_at: null,
  cancelled_by: null,
  cancelled_at: null,
  entered_by: MARCO,
  clashing_bookings: [
    {
      booking_id: "b-1",
      date: "2031-10-20",
      start_time: "15:30:00",
      end_time: "16:30:00",
      child_name: "Emma",
      status: "confirmed",
    },
    {
      booking_id: "b-2",
      date: "2031-10-21",
      start_time: "16:00:00",
      end_time: "17:00:00",
      child_name: "Leo",
      status: "pending",
    },
  ],
  clashing_bookings_count: 2,
};

const APPROVED: ExceptionRead = {
  ...PENDING,
  status: "approved",
  decided_by: RITA,
  decided_at: DECIDED,
};

const ENTERED: ExceptionRead = {
  ...APPROVED,
  entered_by: RITA,
  decided_at: ASKED,
};

const NO_CLASHES = { clashing_bookings: [], clashing_bookings_count: 0 };

const DECLINED: ExceptionRead = {
  ...PENDING,
  ...NO_CLASHES,
  status: "rejected",
  decided_by: RITA,
  decided_at: DECIDED,
};

const CANCELLED: ExceptionRead = {
  ...APPROVED,
  ...NO_CLASHES,
  status: "cancelled",
  cancelled_by: MARCO,
  cancelled_at: DECIDED,
};

const EXPIRED: ExceptionRead = {
  ...PENDING,
  ...NO_CLASHES,
  start_date: "2025-10-06",
  end_date: "2025-10-06",
  status: "expired",
};

function apiError(status: number): AxiosError {
  const response = { status, data: { detail: "x" }, statusText: "", headers: {} };
  return new AxiosError(
    "Request failed",
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    response as AxiosResponse,
  );
}

type HarnessProps = { viewer: Viewer; onClose: () => void };

function Harness({ viewer, onClose }: HarnessProps): ReactNode {
  const [id, setId] = useState<string | null>("to-1");
  return (
    <KitRoot theme="light">
      <button type="button" onClick={() => setId("to-1")}>
        Reopen
      </button>
      <TimeOffDetails
        id={id}
        viewer={viewer}
        backLabel="Time off"
        onClose={() => {
          onClose();
          setId(null);
        }}
      />
    </KitRoot>
  );
}

async function openAs(viewer: Viewer, item?: ExceptionRead) {
  if (item) network.detail.mockResolvedValue(item);
  const onClose = vi.fn();
  await renderWithProviders(<Harness viewer={viewer} onClose={onClose} />);
  return onClose;
}

const overlay = () => page.getByRole("dialog");
const well = () =>
  document.querySelector<HTMLElement>("[data-kit-overlays] p[tabindex='-1']");
const clashBlock = () =>
  document.querySelector<HTMLElement>("[data-kit-overlays] section");

// A token's resolved colour, read the way the browser paints it.
function tokenColor(token: string): string {
  const probe = document.createElement("span");
  probe.style.backgroundColor = `var(${token})`;
  document.querySelector("[data-kit]")?.append(probe);
  const color = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return color;
}

function backgroundOf(element: Element | null): string {
  return element ? getComputedStyle(element).backgroundColor : "";
}

beforeEach(async () => {
  await page.viewport(DESKTOP, HEIGHT);
  network.detail.mockReset();
  network.cancel.mockReset();
});

describe.each([DESKTOP, PHONE])("content at %ipx", (width) => {
  beforeEach(async () => {
    await page.viewport(width, HEIGHT);
  });

  it("shows an Admin a Tutor’s pending request with its clashes", async () => {
    await openAs(ADMIN, PENDING);

    await expect.element(overlay()).toHaveAccessibleName("Time off for Marco Bell");
    await expect.element(page.getByText("Pending", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Marco Bell")).toBeVisible();
    await expect.element(page.getByText("· Tutor")).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "Mon, Oct 20 – Wed, Oct 22" }))
      .toBeVisible();
    await expect
      .element(page.getByText("Waiting for an Admin to approve or decline."))
      .toBeVisible();
    await expect.element(page.getByText("3 days")).toBeVisible();
    await expect.element(page.getByText("Family trip")).toBeVisible();
    await expect.element(page.getByText("Asked", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Oct 14, 3:10 PM")).toBeVisible();
    await expect.element(page.getByText("2 Bookings in these dates")).toBeVisible();
    await expect.element(page.getByText("Mon, Oct 20, 3:30 PM")).toBeVisible();
    await expect.element(page.getByText("Tue, Oct 21, 4:00 PM")).toBeVisible();
    await expect
      .element(
        page.getByText(
          "Approving keeps them and puts them in To do, to change or keep.",
        ),
      )
      .toBeVisible();
  });

  it("shows the Tutor their own pending request as sessions", async () => {
    await openAs(TUTOR, PENDING);

    await expect
      .element(
        page.getByText(
          "Waiting for an Admin. You can still be booked until it’s approved.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByText("You asked")).toBeVisible();
    await expect.element(page.getByText("2 sessions in these dates")).toBeVisible();
    await expect
      .element(
        page.getByText("If it’s approved, the office will change or keep them."),
      )
      .toBeVisible();
    expect(page.getByText("Marco Bell").elements()).toHaveLength(0);
  });

  it("says who entered approved time off for the Tutor", async () => {
    await openAs(TUTOR, ENTERED);

    await expect.element(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText(
          "Added by Rita, so it took effect straight away. You can’t be booked in these times.",
        ),
      )
      .toBeVisible();
    await expect
      .element(
        page.getByText("They wait in To do for the office to change or keep."),
      )
      .toBeVisible();
  });

  it("tells the deciding Admin they approved it", async () => {
    await openAs(ADMIN, APPROVED);

    await expect
      .element(
        page.getByText(
          "Approved by you, Oct 15, 9:00 AM. They can’t be booked in these times.",
        ),
      )
      .toBeVisible();
  });

  it("shows declined time off with no clash block and no acts", async () => {
    await openAs(TUTOR, DECLINED);

    await expect.element(page.getByText("Declined", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText("Declined by Rita, Oct 15, 9:00 AM. You can still be booked."),
      )
      .toBeVisible();
    expect(clashBlock()).toBeNull();
    expect(overlay().getByRole("button", { name: /Cancel/ }).elements()).toHaveLength(0);
  });

  it("shows cancelled time off with no clash block and no acts", async () => {
    await openAs(ADMIN, CANCELLED);

    await expect.element(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Cancelled by Marco, Oct 15, 9:00 AM."))
      .toBeVisible();
    expect(clashBlock()).toBeNull();
    expect(overlay().getByRole("button", { name: /Cancel/ }).elements()).toHaveLength(0);
  });

  it("shows an expired request as never having taken effect", async () => {
    await openAs(TUTOR, EXPIRED);

    await expect.element(page.getByText("Expired", { exact: true })).toBeVisible();
    await expect
      .element(
        page.getByText("Nobody decided before it started, so it never took effect."),
      )
      .toBeVisible();
    expect(clashBlock()).toBeNull();
    expect(overlay().getByRole("button", { name: /Cancel/ }).elements()).toHaveLength(0);
  });

  it("says when there are no Bookings and no reason", async () => {
    await openAs(ADMIN, { ...APPROVED, ...NO_CLASHES, reason: null });

    await expect.element(page.getByText("No Bookings in these dates")).toBeVisible();
    await expect.element(page.getByText("No reason given")).toBeVisible();
  });

  it("gives a Manager no acts on someone else’s time off", async () => {
    await openAs(MANAGER, APPROVED);

    await expect.element(page.getByText("2 Bookings in these dates")).toBeVisible();
    expect(overlay().getByRole("button", { name: /Cancel|Approve|Decline/ }).elements()).toHaveLength(0);
  });
});

describe("tones", () => {
  const cases: [string, ExceptionRead, string][] = [
    ["pending", PENDING, "--tl-warning-tint"],
    ["approved", APPROVED, "--tl-success-tint"],
    ["declined", DECLINED, "--tl-danger-tint"],
    ["cancelled", CANCELLED, "--tl-neutral-tint"],
    ["expired", EXPIRED, "--tl-neutral-tint"],
  ];

  it.each(cases)("puts %s in its tone well", async (_name, item, token) => {
    await openAs(ADMIN, item);
    await expect.element(page.getByRole("heading", { level: 2 }).first()).toBeVisible();

    expect(backgroundOf(well())).toBe(tokenColor(token));
    expect(getComputedStyle(well() as Element).borderRadius).toBe("16px");
  });

  it("draws the clash block warning with clashes and sunk without", async () => {
    await openAs(ADMIN, PENDING);
    await expect.element(page.getByText("2 Bookings in these dates")).toBeVisible();
    expect(backgroundOf(clashBlock())).toBe(tokenColor("--tl-warning-tint"));
    expect(getComputedStyle(clashBlock() as Element).borderRadius).toBe("16px");
  });

  it("draws the no-clash block sunk", async () => {
    await openAs(ADMIN, { ...PENDING, ...NO_CLASHES });
    await expect.element(page.getByText("No Bookings in these dates")).toBeVisible();
    expect(backgroundOf(clashBlock())).toBe(tokenColor("--tl-surface-sunk"));
  });
});

describe("Cancel", () => {
  it("offers the owner Cancel request, worded for them", async () => {
    await openAs(TUTOR, PENDING);
    await page.getByRole("button", { name: "Cancel request" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toHaveAccessibleName("Cancel this request?");
    await expect
      .element(dialog)
      .toHaveTextContent(
        "Mon, Oct 20 – Wed, Oct 22. You can be booked in these times again. To change the dates, cancel and request again.",
      );
    await expect.element(dialog.getByRole("button", { name: "Cancel request" })).toBeVisible();
    await dialog.getByRole("button", { name: "Keep it" }).click();

    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    expect(network.cancel).not.toHaveBeenCalled();
  });

  it("offers the owner Cancel time off once it is approved", async () => {
    await openAs(TUTOR, APPROVED);
    await expect.element(page.getByRole("button", { name: "Cancel time off" })).toBeVisible();
  });

  it("never offers an Admin Cancel on someone else’s pending request", async () => {
    await openAs(ADMIN, PENDING);
    await expect.element(page.getByText("2 Bookings in these dates")).toBeVisible();
    expect(overlay().getByRole("button", { name: /Cancel/ }).elements()).toHaveLength(0);
  });

  it("cancels for an Admin, keeps the overlay open showing Cancelled, with no Undo", async () => {
    const cancelled: ExceptionRead = {
      ...APPROVED,
      ...NO_CLASHES,
      status: "cancelled",
      cancelled_by: RITA,
      cancelled_at: DECIDED,
    };
    network.cancel.mockResolvedValue(cancelled);
    await openAs(ADMIN, APPROVED);
    await page.getByRole("button", { name: "Cancel time off" }).click();

    const dialog = page.getByRole("alertdialog");
    await expect.element(dialog).toHaveAccessibleName("Cancel this time off?");
    await expect
      .element(dialog)
      .toHaveTextContent(
        "Mon, Oct 20 – Wed, Oct 22. Marco can be booked in these times again.",
      );
    network.detail.mockResolvedValue(cancelled);
    await dialog.getByRole("button", { name: "Cancel time off" }).click();

    await expect.element(page.getByText("Cancelled Marco’s time off.")).toBeVisible();
    expect(network.cancel).toHaveBeenCalledWith("to-1");
    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    await expect.element(overlay()).toBeVisible();
    await expect.element(page.getByText("Cancelled", { exact: true })).toBeVisible();
    await expect
      .element(page.getByText("Cancelled by you, Oct 15, 9:00 AM."))
      .toBeVisible();
    expect(overlay().getByRole("button", { name: "Cancel time off" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Undo" }).elements()).toHaveLength(0);
    await vi.waitFor(() => expect(document.activeElement).toBe(well()));
  });

  it("thanks the owner in their own words", async () => {
    network.cancel.mockResolvedValue({ ...PENDING, status: "cancelled" });
    await openAs(TUTOR, PENDING);
    await page.getByRole("button", { name: "Cancel request" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel request" }).click();

    await expect.element(page.getByText("Cancelled your time off.")).toBeVisible();
  });

  it("shows a failure as an alert at the top of the footer", async () => {
    network.cancel.mockRejectedValue(apiError(500));
    await openAs(TUTOR, APPROVED);
    await page.getByRole("button", { name: "Cancel time off" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel time off" }).click();

    const alert = overlay().getByRole("alert");
    await expect
      .element(alert)
      .toHaveTextContent("Couldn’t cancel it. Check your connection and try again.");
    const button = overlay().getByRole("button", { name: "Cancel time off" });
    await expect.element(button).toBeVisible();
    const footer = button.element().closest(".border-t");
    expect(footer?.firstElementChild?.firstElementChild).toBe(alert.element());

    await button.click();
    await expect.element(page.getByRole("alertdialog")).toBeVisible();
    expect(overlay().getByRole("alert").elements()).toHaveLength(0);
  });

  it("closes the dialog as soon as the cancel lands, before any refetch", async () => {
    network.cancel.mockResolvedValue({ ...PENDING, status: "cancelled" });
    await openAs(TUTOR, PENDING);
    await page.getByRole("button", { name: "Cancel request" }).click();
    network.detail.mockReturnValue(new Promise(() => {}));
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel request" }).click();

    await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
    await expect.element(page.getByText("Cancelled your time off.")).toBeVisible();
  });

  it("forgets a failure once the overlay is closed and reopened", async () => {
    network.cancel.mockRejectedValue(apiError(500));
    await openAs(TUTOR, APPROVED);
    await page.getByRole("button", { name: "Cancel time off" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel time off" }).click();
    await expect.element(overlay().getByRole("alert")).toBeVisible();

    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(overlay()).not.toBeInTheDocument();
    await page.getByRole("button", { name: "Reopen" }).click();

    await expect.element(overlay().getByRole("button", { name: "Cancel time off" })).toBeVisible();
    expect(overlay().getByRole("alert").elements()).toHaveLength(0);
  });

  it("refetches on a 409 and says the time off changed", async () => {
    network.cancel.mockRejectedValue(apiError(409));
    await openAs(TUTOR, APPROVED);
    await page.getByRole("button", { name: "Cancel time off" }).click();
    network.detail.mockResolvedValue({
      ...CANCELLED,
      cancelled_by: RITA,
    });
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel time off" }).click();

    await expect
      .element(overlay().getByRole("alert"))
      .toHaveTextContent("This time off changed. Check its status and try again.");
    await expect
      .element(page.getByText("Cancelled by Rita, Oct 15, 9:00 AM."))
      .toBeVisible();
    expect(network.detail).toHaveBeenCalledTimes(2);
    expect(overlay().getByRole("button", { name: "Cancel time off" }).elements()).toHaveLength(0);
  });
});

describe("states", () => {
  it("shows a skeleton while it loads", async () => {
    network.detail.mockReturnValue(new Promise(() => {}));
    await openAs(ADMIN);

    await expect
      .element(page.getByRole("status", { name: "Loading time off" }))
      .toBeVisible();
  });

  it.each([403, 404])("says it couldn’t find it on a %i, with a way back", async (status) => {
    network.detail.mockRejectedValue(apiError(status));
    const onClose = await openAs(TUTOR);

    await expect.element(page.getByText("Couldn’t find this time off")).toBeVisible();
    await expect
      .element(page.getByText("It may have been removed, or it isn’t yours to see."))
      .toBeVisible();
    await page.getByRole("button", { name: "Back to Time off" }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it("offers Try again when it fails to load", async () => {
    network.detail.mockRejectedValueOnce(apiError(500));
    await openAs(ADMIN);

    await expect.element(page.getByText("Couldn’t load this time off")).toBeVisible();
    await expect
      .element(page.getByText("Check your connection and try again."))
      .toBeVisible();
    network.detail.mockResolvedValue(APPROVED);
    await page.getByRole("button", { name: "Try again" }).click();

    await expect.element(page.getByText("2 Bookings in these dates")).toBeVisible();
  });
});

describe("layout", () => {
  it("is a pushed page on a phone, with the back label and a full-width button", async () => {
    await page.viewport(PHONE, HEIGHT);
    await openAs(TUTOR, APPROVED);

    const back = page.getByRole("button", { name: "Time off", exact: true });
    await expect.element(back).toBeVisible();
    expect(page.getByRole("button", { name: "Close" }).elements()).toHaveLength(0);
    const panel = overlay().element().getBoundingClientRect();
    expect(panel.width).toBe(PHONE);
    const cancel = page.getByRole("button", { name: "Cancel time off" });
    await expect.element(cancel).toBeVisible();
    const footer = cancel.element().closest(".border-t") as HTMLElement;
    const footerStyle = getComputedStyle(footer);
    const footerInner =
      footer.clientWidth -
      parseFloat(footerStyle.paddingLeft) -
      parseFloat(footerStyle.paddingRight);
    expect(cancel.element().getBoundingClientRect().width).toBeCloseTo(footerInner, 0);
  });

  it("is a 440px slide-over on a wide screen, with a Close button", async () => {
    await openAs(TUTOR, APPROVED);

    await expect.element(page.getByRole("button", { name: "Close" })).toBeVisible();
    expect(
      page.getByRole("button", { name: "Time off", exact: true }).elements(),
    ).toHaveLength(0);
    await vi.waitFor(() =>
      expect(overlay().element().getBoundingClientRect().width).toBe(SLIDE_OVER_WIDTH),
    );
  });

  it("never scrolls sideways at 320px", async () => {
    await page.viewport(NARROWEST, HEIGHT);
    await openAs(ADMIN, { ...ENTERED, reason: "A very long reason that keeps going and going" });
    await expect.element(page.getByText("2 Bookings in these dates")).toBeVisible();

    const panel = overlay().element();
    const scroller = panel.querySelector(".overflow-y-auto") as HTMLElement;
    expect(scroller.scrollWidth).toBeLessThanOrEqual(scroller.clientWidth);
    expect(panel.getBoundingClientRect().width).toBe(NARROWEST);
  });

  it("gives every button a 44px target", async () => {
    await page.viewport(PHONE, HEIGHT);
    await openAs(TUTOR, PENDING);
    const cancel = page.getByRole("button", { name: "Cancel request" });
    await expect.element(cancel).toBeVisible();

    for (const button of overlay().getByRole("button").elements()) {
      if (button.getBoundingClientRect().height === 0) continue;
      expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
  });
});
