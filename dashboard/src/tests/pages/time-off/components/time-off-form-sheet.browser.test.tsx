import { useState } from "react";
import type { ReactNode } from "react";
import { queryOptions } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type { AxiosResponse } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import { getTodayKey } from "@/components/kit/format";
import type { Staff } from "@/lib/queries/staff";
import type {
  ExceptionCreate,
  ExceptionRead,
  NamedRef,
  TimeOffWarning,
} from "@/lib/queries/time-off";
import TimeOffFormSheet from "@/pages/time-off/components/time-off-form-sheet";
import type { TimeOffFormMode } from "@/pages/time-off/lib/time-off-form";
import type { Viewer } from "@/pages/time-off/lib/time-off-rules";
import { renderWithProviders } from "@/test/render-with-providers";

const network = vi.hoisted(() => ({ staff: vi.fn(), create: vi.fn() }));

vi.mock("@/lib/queries/staff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/staff")>();
  return {
    ...actual,
    staffQueries: {
      ...actual.staffQueries,
      active: () =>
        queryOptions({
          ...actual.staffQueries.active(),
          queryFn: () => network.staff(),
        }),
    },
  };
});

vi.mock("@/lib/queries/time-off", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/time-off")>();
  return {
    ...actual,
    timeOffMutations: {
      ...actual.timeOffMutations,
      create: () => ({
        ...actual.timeOffMutations.create(),
        mutationFn: ({ userId, body }: { userId: string; body: ExceptionCreate }) =>
          network.create(userId, body),
      }),
    },
  };
});

const DESKTOP = 1280;
const PHONE = 390;
const HEIGHT = 800;
const CARD_WIDTH = 480;

// Far ahead, so request mode's "today or later" holds whatever today is.
const FIRST = "2031-10-20";
const LAST = "2031-10-22";
const PAST = "2020-01-06";

const RITA: Staff = { id: "u-admin", name: "Rita Souza", role: "admin", tutor_id: null };
const MARCO: Staff = { id: "u-tutor", name: "Marco Bell", role: "tutor", tutor_id: "t-1" };
const ANA: Staff = { id: "u-manager", name: "Ana Brooks", role: "manager", tutor_id: null };
const ADMIN: Viewer = { id: RITA.id, role: "admin" };
const TUTOR: Viewer = { id: MARCO.id, role: "tutor" };
const MARCO_REF: NamedRef = { id: MARCO.id, name: MARCO.name };

const CREATED: ExceptionRead = {
  id: "to-1",
  staff: { id: MARCO.id, name: MARCO.name, role: "tutor" },
  start_date: FIRST,
  end_date: FIRST,
  start_time: null,
  end_time: null,
  reason: null,
  status: "pending",
  created_at: "2031-10-14T19:10:00Z",
  decided_by: null,
  decided_at: null,
  cancelled_by: null,
  cancelled_at: null,
  entered_by: { id: MARCO.id, name: MARCO.name },
  clashing_bookings: [],
  clashing_bookings_count: 0,
};

const CLASHES = [
  {
    booking_id: "b-1",
    date: FIRST,
    start_time: "15:30:00",
    end_time: "16:30:00",
    child_name: "Emma",
    status: "confirmed" as const,
  },
  {
    booking_id: "b-2",
    date: "2031-10-21",
    start_time: "16:00:00",
    end_time: "17:00:00",
    child_name: "Leo",
    status: "pending" as const,
  },
];

const CLASH_WARNING: TimeOffWarning = {
  code: "booking_clash",
  message: "This time off clashes with 2 booking(s)",
  clashing_bookings: CLASHES,
};

function apiError(status: number, detail: string): AxiosError {
  const response = { status, data: { detail }, statusText: "", headers: {} };
  return new AxiosError(
    "Request failed",
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    response as AxiosResponse,
  );
}

type HarnessProps = {
  mode: TimeOffFormMode;
  viewer: Viewer;
  person?: NamedRef;
  onCreated: (item: ExceptionRead) => void;
};

function Harness({ mode, viewer, person, onCreated }: HarnessProps): ReactNode {
  const [isOpen, setIsOpen] = useState(true);
  return (
    <KitRoot theme="light">
      <button type="button" onClick={() => setIsOpen(true)}>
        Open
      </button>
      <TimeOffFormSheet
        isOpen={isOpen}
        mode={mode}
        viewer={viewer}
        person={person}
        onClose={() => setIsOpen(false)}
        onCreated={onCreated}
      />
    </KitRoot>
  );
}

async function openSheet(mode: TimeOffFormMode, viewer: Viewer, person?: NamedRef) {
  const onCreated = vi.fn();
  await renderWithProviders(
    <Harness mode={mode} viewer={viewer} person={person} onCreated={onCreated} />,
  );
  await expect.element(sheet()).toBeVisible();
  return onCreated;
}

const sheet = () => page.getByRole("dialog");
const firstDay = () => page.getByLabelText("First day");
const lastDay = () => page.getByLabelText("Last day");
const partDay = () => page.getByRole("switch", { name: "Only part of the day" });
const fromTime = () => page.getByLabelText("From");
const toTime = () => page.getByLabelText("To", { exact: true });
const reason = () => page.getByLabelText("Reason");
const forField = () => page.getByRole("combobox", { name: "For (required)" });
const forGroup = () => page.getByRole("group", { name: "For (required)" });
const button = (name: string) => page.getByRole("button", { name, exact: true });
const warningWell = () =>
  sheet().getByRole("alert").filter({ hasText: "This time off clashes" });
const formAlertText = "Couldn’t save the time off. Check your connection and try again.";

async function pickPerson(name: string): Promise<void> {
  await forField().click();
  await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
}

function lastBody(): ExceptionCreate {
  return network.create.mock.lastCall?.[1] as ExceptionCreate;
}

beforeEach(async () => {
  await page.viewport(DESKTOP, HEIGHT);
  network.staff.mockReset();
  network.create.mockReset();
  network.staff.mockResolvedValue({
    items: [RITA, MARCO, ANA],
    total: 3,
    page: 1,
    page_size: 100,
  });
  network.create.mockResolvedValue({ kind: "saved", item: CREATED });
});

describe.each([DESKTOP, PHONE])("at %ipx", (width) => {
  beforeEach(async () => {
    await page.viewport(width, HEIGHT);
  });

  it("asks a Tutor for their own time off in request mode", async () => {
    await openSheet("request", TUTOR);

    await expect.element(sheet()).toHaveAccessibleName("Request time off");
    await expect
      .element(
        page.getByText(
          "An Admin approves or declines it. You’ll see the answer on Time off.",
        ),
      )
      .toBeVisible();
    expect(forField().elements()).toHaveLength(0);
    await expect.element(firstDay()).toHaveAttribute("min", getTodayKey());
    await expect.element(page.getByText("Leave empty for one day.")).toBeVisible();
    await expect.element(page.getByText("The same hours on each day.")).toBeVisible();
    await expect
      .element(page.getByText("Optional. Admins see it with your request."))
      .toBeVisible();
    await expect.element(button("Not now")).toBeVisible();
    await expect.element(button("Send request")).toBeVisible();
    await expect.element(firstDay()).toHaveFocus();
  });

  it("lets an Admin pick anyone, marking themselves", async () => {
    await openSheet("add", ADMIN);

    await expect.element(sheet()).toHaveAccessibleName("Add time off");
    await expect
      .element(page.getByText("Takes effect straight away, with no approval."))
      .toBeVisible();
    await expect
      .element(page.getByText("Optional. The person sees it too."))
      .toBeVisible();
    await expect.element(button("Add time off")).toBeVisible();
    await expect.element(firstDay()).not.toHaveAttribute("min");
    await forField().click();
    await expect
      .element(page.getByRole("option", { name: /^Rita Souza \(you\)/ }))
      .toBeVisible();
    await expect
      .element(page.getByRole("option", { name: /^Marco Bell.*Tutor/ }))
      .toBeVisible();
    expect(page.getByRole("option").elements()).toHaveLength(3);
  });

  it("fixes the person and names them when one is preset", async () => {
    await openSheet("add", ADMIN, MARCO_REF);

    await expect.element(sheet()).toHaveAccessibleName("Add time off for Marco");
    expect(forField().elements()).toHaveLength(0);
    expect(network.staff).not.toHaveBeenCalled();
  });

  it("sends a whole-day request and says it was sent", async () => {
    const onCreated = await openSheet("request", TUTOR);

    await firstDay().fill(FIRST);
    await reason().fill("  Family trip  ");
    await button("Send request").click();

    await expect
      .element(page.getByText("Request sent. You’ll see here when an Admin decides."))
      .toBeVisible();
    expect(network.create).toHaveBeenCalledWith(MARCO.id, {
      start_date: FIRST,
      end_date: FIRST,
      start_time: null,
      end_time: null,
      reason: "Family trip",
      confirm_warnings: [],
    });
    expect(onCreated).toHaveBeenCalledWith(CREATED);
    expect(sheet().elements()).toHaveLength(0);
  });

  it("sends a part-day window with its hours", async () => {
    await openSheet("add", ADMIN, MARCO_REF);

    await firstDay().fill(FIRST);
    await lastDay().fill(LAST);
    await partDay().click();
    await expect.element(fromTime()).toHaveValue("13:00");
    await expect.element(toTime()).toHaveValue("17:00");
    await fromTime().fill("09:30");
    await button("Add time off").click();

    await expect
      .element(page.getByText("Time off added for Marco. It’s in effect now."))
      .toBeVisible();
    expect(lastBody()).toEqual({
      start_date: FIRST,
      end_date: LAST,
      start_time: "09:30:00",
      end_time: "17:00:00",
      reason: null,
      confirm_warnings: [],
    });
  });
});

describe("validation", () => {
  it("says who it’s for and the first day are missing, then rechecks on blur", async () => {
    await openSheet("add", ADMIN);
    await expect.element(forField()).toBeVisible();

    await button("Add time off").click();

    await expect.element(page.getByText("Pick who the time off is for.")).toBeVisible();
    await expect.element(page.getByText("Pick the first day off.")).toBeVisible();
    await expect.element(forField()).toHaveFocus();
    expect(network.create).not.toHaveBeenCalled();

    await pickPerson("Ana Brooks");
    await expect
      .element(page.getByText("Pick who the time off is for."))
      .not.toBeInTheDocument();
    await firstDay().fill(FIRST);
    await reason().click();
    await expect
      .element(page.getByText("Pick the first day off."))
      .not.toBeInTheDocument();
  });

  it("shows nothing until the first submit", async () => {
    await openSheet("request", TUTOR);

    await firstDay().fill(PAST);
    await reason().click();

    expect(page.getByText("That day has passed. Pick today or later.").elements())
      .toHaveLength(0);
  });

  it("refuses a past first day in request mode only", async () => {
    await openSheet("request", TUTOR);

    await firstDay().fill(PAST);
    await button("Send request").click();

    await expect
      .element(page.getByText("That day has passed. Pick today or later."))
      .toBeVisible();
    await expect.element(firstDay()).toHaveAttribute("aria-invalid", "true");
    expect(network.create).not.toHaveBeenCalled();
  });

  it("lets an Admin add time off that has passed", async () => {
    await openSheet("add", ADMIN, MARCO_REF);

    await firstDay().fill(PAST);
    await button("Add time off").click();

    await expect.poll(() => network.create.mock.calls.length).toBe(1);
    expect(lastBody().start_date).toBe(PAST);
  });

  it("refuses a last day before the first, and clears it on blur once fixed", async () => {
    await openSheet("request", TUTOR);

    await firstDay().fill(LAST);
    await lastDay().fill(FIRST);
    await button("Send request").click();

    await expect
      .element(page.getByText("The last day can’t be before the first."))
      .toBeVisible();
    await lastDay().fill("");
    await reason().click();
    await expect
      .element(page.getByText("The last day can’t be before the first."))
      .not.toBeInTheDocument();
  });

  it("refuses part-day hours that end before they start", async () => {
    await openSheet("request", TUTOR);

    await firstDay().fill(FIRST);
    await partDay().click();
    await toTime().fill("12:00");
    await button("Send request").click();

    await expect
      .element(page.getByText("Ends before it starts. Pick a later time."))
      .toBeVisible();
    await expect.element(toTime()).toHaveFocus();
    await toTime().fill("18:00");
    await reason().click();
    await expect
      .element(page.getByText("Ends before it starts. Pick a later time."))
      .not.toBeInTheDocument();
  });
});

describe("the clash warning", () => {
  beforeEach(() => {
    network.create
      .mockResolvedValueOnce({ kind: "warning", warnings: [CLASH_WARNING] })
      .mockResolvedValue({
        kind: "saved",
        item: { ...CREATED, status: "approved" },
      });
  });

  it("shows the clashes in place and confirms them on Add anyway", async () => {
    await openSheet("add", ADMIN);
    await pickPerson("Marco Bell");
    await firstDay().fill(FIRST);
    await button("Add time off").click();

    await expect.element(warningWell()).toBeVisible();
    await expect
      .element(page.getByText("This time off clashes with 2 Bookings"))
      .toBeVisible();
    await expect.element(page.getByText("Mon, Oct 20, 3:30 PM")).toBeVisible();
    await expect.element(page.getByText("Tue, Oct 21, 4:00 PM")).toBeVisible();
    await expect
      .element(
        page.getByText(
          "Adding it keeps those Bookings and puts them in To do to change or keep.",
        ),
      )
      .toBeVisible();
    expect(getComputedStyle(warningWell().element()).borderRadius).toBe("16px");

    await button("Add anyway").click();

    await expect
      .element(page.getByText("Time off added for Marco. It’s in effect now."))
      .toBeVisible();
    expect(lastBody().confirm_warnings).toEqual(["booking_clash"]);
  });

  it("goes away when the dates change", async () => {
    await openSheet("add", ADMIN, MARCO_REF);
    await firstDay().fill(FIRST);
    await button("Add time off").click();
    await expect.element(warningWell()).toBeVisible();

    await lastDay().fill(LAST);

    await expect.element(warningWell()).not.toBeInTheDocument();
    await expect.element(button("Add time off")).toBeVisible();
    await button("Add time off").click();
    await expect.poll(() => network.create.mock.calls.length).toBe(2);
    expect(lastBody().confirm_warnings).toEqual([]);
  });
});

describe("outcomes", () => {
  it("tells a requester the office will sort out their sessions", async () => {
    network.create.mockResolvedValue({
      kind: "saved",
      item: { ...CREATED, clashing_bookings: CLASHES, clashing_bookings_count: 2 },
    });
    await openSheet("request", TUTOR);

    await firstDay().fill(FIRST);
    await button("Send request").click();

    await expect
      .element(
        page.getByText(
          "Request sent. If it’s approved, the office will sort out your sessions in those dates.",
        ),
      )
      .toBeVisible();
  });

  it("says “you” when an Admin adds their own time off", async () => {
    const onCreated = await openSheet("add", ADMIN);

    await pickPerson("Rita Souza");
    await firstDay().fill(FIRST);
    await button("Add time off").click();

    await expect
      .element(page.getByText("Time off added for you. It’s in effect now."))
      .toBeVisible();
    expect(network.create.mock.lastCall?.[0]).toBe(RITA.id);
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it("keeps the sheet open with an alert when the save fails", async () => {
    network.create.mockRejectedValue(apiError(500, "boom"));
    const onCreated = await openSheet("request", TUTOR);

    await firstDay().fill(FIRST);
    await button("Send request").click();

    await expect.element(sheet().getByRole("alert")).toHaveTextContent(formAlertText);
    await expect.element(firstDay()).toHaveValue(FIRST);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("points at the For field when the person is archived", async () => {
    network.create.mockRejectedValue(
      apiError(422, "Time off cannot be entered for an archived user"),
    );
    await openSheet("add", ADMIN);

    await pickPerson("Ana Brooks");
    await firstDay().fill(FIRST);
    await button("Add time off").click();

    await expect.element(page.getByText("This Staff member is archived.")).toBeVisible();
    await expect.element(forField()).toHaveAttribute("aria-invalid", "true");
  });

  it("points at the first day when the window has ended", async () => {
    network.create.mockRejectedValue(apiError(422, "This time off has already ended"));
    await openSheet("request", TUTOR);

    await firstDay().fill(FIRST);
    await button("Send request").click();

    await expect
      .element(page.getByText("That day has passed. Pick today or later."))
      .toBeVisible();
  });

  it("disables the form and ignores closing while saving", async () => {
    let resolveSave: (value: unknown) => void = () => undefined;
    network.create.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    await openSheet("request", TUTOR);

    await firstDay().fill(FIRST);
    await button("Send request").click();

    await expect.element(firstDay()).toBeDisabled();
    await expect.element(button("Not now")).toBeDisabled();
    await button("Close").click();
    await expect.element(sheet()).toBeVisible();

    resolveSave({ kind: "saved", item: CREATED });
    await expect.element(sheet()).not.toBeInTheDocument();
  });

  it("resets every field when closed", async () => {
    network.create.mockRejectedValue(apiError(500, "boom"));
    await openSheet("request", TUTOR);

    await firstDay().fill(FIRST);
    await partDay().click();
    await reason().fill("Dentist");
    await button("Send request").click();
    await expect.element(page.getByText(formAlertText)).toBeVisible();

    await button("Not now").click();
    await expect.element(sheet()).not.toBeInTheDocument();
    await button("Open").click();

    await expect.element(firstDay()).toHaveValue("");
    await expect.element(reason()).toHaveValue("");
    await expect.element(partDay()).toHaveAttribute("aria-checked", "false");
    expect(page.getByText(formAlertText).elements()).toHaveLength(0);
  });
});

describe("layout", () => {
  it("is a 480px card with the dates side by side on desktop", async () => {
    await openSheet("request", TUTOR);

    expect(sheet().element().getBoundingClientRect().width).toBe(CARD_WIDTH);
    const first = firstDay().element().getBoundingClientRect();
    const last = lastDay().element().getBoundingClientRect();
    expect(last.top).toBe(first.top);
    const notNow = button("Not now").element().getBoundingClientRect();
    const send = button("Send request").element().getBoundingClientRect();
    expect(send.left).toBeGreaterThan(notNow.left);
  });

  it("is a bottom sheet with stacked dates and the primary on top on phones", async () => {
    await page.viewport(PHONE, HEIGHT);
    await openSheet("request", TUTOR);

    const panel = sheet().element().getBoundingClientRect();
    expect(panel.width).toBe(PHONE);
    const first = firstDay().element().getBoundingClientRect();
    const last = lastDay().element().getBoundingClientRect();
    expect(last.top).toBeGreaterThan(first.bottom);
    const notNow = button("Not now").element().getBoundingClientRect();
    const send = button("Send request").element().getBoundingClientRect();
    expect(send.bottom).toBeLessThanOrEqual(notNow.top);

    await partDay().click();
    const from = fromTime().element().getBoundingClientRect();
    const to = toTime().element().getBoundingClientRect();
    expect(to.top).toBe(from.top);
  });

  it("shows a skeleton while Staff load and a retry when they fail", async () => {
    network.staff.mockReturnValue(new Promise(() => undefined));
    await openSheet("add", ADMIN);

    await expect
      .element(page.getByRole("status", { name: "Loading Staff" }))
      .toBeVisible();
  });

  it("says who it’s for is missing while Staff are still loading", async () => {
    network.staff.mockReturnValue(new Promise(() => undefined));
    await openSheet("add", ADMIN);

    await firstDay().fill(FIRST);
    await button("Add time off").click();

    await expect.element(page.getByText("Pick who the time off is for.")).toBeVisible();
    await expect.element(forGroup()).toHaveAttribute("aria-invalid", "true");
    await expect.element(forGroup()).toHaveFocus();
    expect(network.create).not.toHaveBeenCalled();
  });

  it("says who it’s for is missing when Staff failed to load", async () => {
    network.staff.mockRejectedValue(new Error("offline"));
    await openSheet("add", ADMIN);
    await expect.element(page.getByRole("button", { name: "Try again" })).toBeVisible();

    await firstDay().fill(FIRST);
    await button("Add time off").click();

    await expect
      .element(forGroup())
      .toHaveAccessibleDescription("Pick who the time off is for.");
    await expect.element(forGroup()).toHaveFocus();
    expect(network.create).not.toHaveBeenCalled();
  });

  it("offers Try again when Staff fail to load", async () => {
    network.staff.mockRejectedValueOnce(new Error("offline"));
    await openSheet("add", ADMIN);

    await expect
      .element(
        page.getByText("Couldn’t load Staff. Check your connection and try again."),
      )
      .toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect.element(forField()).toBeVisible();
  });
});
