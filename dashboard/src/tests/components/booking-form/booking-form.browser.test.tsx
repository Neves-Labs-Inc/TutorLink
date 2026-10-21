import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse } from "axios";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import BookingOverlaysProvider from "@/components/booking-overlays/booking-overlays-provider";
import KitRoot from "@/components/kit/kit-root";
import { useBookingOverlays } from "@/hooks/use-booking-overlays";
import type { BookingFormPrefill } from "@/lib/bookings/booking-form";
import type { BookingDetail } from "@/lib/queries/bookings";
import { useAuthStore } from "@/stores/authStore";
import { renderWithProviders } from "@/test/render-with-providers";

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: network,
}));

const DAY = "2099-10-15";
const READ_AT = "2026-10-20T14:00:00Z";
const FRESH_AT = "2026-10-21T09:00:00Z";
const MATH = { id: "s-math", name: "Math", max_grade_level: 12 };

type Params = Record<string, unknown> | undefined;

function makeStaff(id: string, name: string, role: string, tutorId: string | null) {
  return {
    id,
    name,
    role,
    tutor_id: tutorId,
    email: `${id}@example.com`,
    sign_in_state: "active",
    invite_expires_at: null,
    archived: false,
    subjects: role === "manager" ? [] : [MATH],
    sessions_this_week: 0,
    assigned_children: [],
    phone_number: null,
    bio: null,
    has_pending_time_off: false,
  };
}

const STAFF = [
  makeStaff("u-ana", "Ana Souza", "tutor", "t-ana"),
  makeStaff("u-bia", "Bia Reis", "tutor", "t-bia"),
  makeStaff("u-dora", "Dora Lima", "admin", null),
  makeStaff("u-eva", "Eva Costa", "manager", null),
];

function makeSummary(id: string, name: string, isEvaluated: boolean) {
  return {
    id,
    name,
    grade_level: 5,
    school_name: "Oak",
    archived: false,
    guardians: [{ id: "g-1", name: "Diana Souza" }],
    homes: [],
    next_session: null,
    levels: [],
    evaluated: isEvaluated ? { at: READ_AT, by: { id: "u-dora", name: "Dora Lima" } } : null,
    assigned_tutors: [],
    created_at: "2099-10-01T12:00:00Z",
  };
}

const EMMA = makeSummary("c-emma", "Emma Souza", true);
const LEO = makeSummary("c-leo", "Leo Reis", false);

function makeChildDetail(id: string, name: string, isEvaluated: boolean) {
  return {
    id,
    name,
    date_of_birth: null,
    grade_level: 5,
    school_name: "Oak",
    notes: null,
    archived: false,
    upcoming_session_count: 0,
    next_session: null,
    guardians: [],
    homes: [
      {
        id: "h-1",
        label: "Main",
        address: "12 Oak St",
        archived: false,
        guardians: [],
        directions: null,
      },
    ],
    levels: isEvaluated
      ? [
          {
            subject_id: MATH.id,
            name: "Math",
            archived: false,
            level: 5,
            set_by: { id: "u-dora", name: "Dora Lima" },
            updated_at: READ_AT,
          },
        ]
      : [],
    evaluated: isEvaluated ? { at: READ_AT, by: { id: "u-dora", name: "Dora Lima" } } : null,
    assigned_tutors: isEvaluated ? [{ id: "u-ana", name: "Ana Souza", role: "tutor" }] : [],
    evaluation_run_by: null,
  };
}

function makeSlot(tutorId: string, start: string, end: string) {
  return {
    tutor_id: tutorId,
    tutor_name: tutorId,
    availability_id: `a-${tutorId}`,
    date: DAY,
    start_time: start,
    end_time: end,
  };
}

const SLOTS = [
  makeSlot("t-bia", "15:30:00", "16:30:00"),
  makeSlot("t-bia", "17:00:00", "18:00:00"),
];

function makeBooking(overrides: Partial<BookingDetail> = {}): BookingDetail {
  return {
    id: "b-1",
    child: { id: "c-emma", name: "Emma Souza", notes: null },
    staff: { id: "u-ana", name: "Ana Souza", role: "tutor" },
    kind: "regular",
    location: "home",
    subject: { id: MATH.id, name: "Math" },
    subject_level: 5,
    scheduled_date: DAY,
    start_time: "15:00:00",
    end_time: "16:00:00",
    status: "confirmed",
    notes: "Bring the workbook",
    updated_at: READ_AT,
    office_address: null,
    home: { id: "h-1", label: "Main", address: "12 Oak St", directions: null, access_code: "1" },
    booked_by_guardian: null,
    guardians: [{ id: "g-1", name: "Diana Souza", conversation_id: "conv-1" }],
    availability_id: "a-t-ana",
    clashing_time_off: [],
    sort_out_reasons: [],
    clash_acknowledged_by: null,
    clash_acknowledged_at: null,
    created_at: READ_AT,
    ...overrides,
  };
}

function page1<T>(items: T[]) {
  return { data: { items, total: items.length, page: 1, page_size: 100 } };
}

type Server = { booking: BookingDetail; slots: unknown[]; timeOff: unknown[] };
let server: Server;

function route(url: string, params: Params): Promise<unknown> {
  let answer: unknown = null;
  if (url === "/api/staff") answer = page1(STAFF);
  else if (url === "/api/children" && params?.evaluated) answer = page1([EMMA]);
  else if (url === "/api/children" && params?.evaluable) answer = page1([LEO]);
  else if (url === "/api/children/c-emma") answer = { data: makeChildDetail("c-emma", "Emma Souza", true) };
  else if (url === "/api/children/c-leo") answer = { data: makeChildDetail("c-leo", "Leo Reis", false) };
  else if (url.startsWith("/api/slots/available?")) answer = page1(server.slots);
  else if (url === "/api/exceptions") answer = page1(server.timeOff);
  else if (url === "/api/settings") {
    answer = {
      data: {
        items: [{ key: "session_length_minutes", value: "60", value_type: "int", is_developer_only: false }],
        total: 1,
        page: 1,
        page_size: 100,
        business_timezone_locked: true,
        reminders_paused: false,
      },
    };
  } else if (url === "/api/tutors/t-ana/availability") {
    answer = page1([
      { id: "a-t-ana", tutor_id: "t-ana", day_of_week: 3, start_time: "14:00:00", end_time: "18:00:00", is_active: true, mode: "anywhere" },
    ]);
  } else if (url === "/api/bookings/b-1") answer = { data: server.booking };
  else if (url === "/api/bookings/b-new") answer = { data: makeBooking({ id: "b-new" }) };
  return answer === null ? Promise.reject(new Error(`unexpected GET ${url}`)) : Promise.resolve(answer);
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

const CREATED = {
  data: { id: "b-new", status: "confirmed", scheduled_date: DAY, start_time: "15:30:00", end_time: "16:30:00" },
};

let nextPrefill: BookingFormPrefill = {};

function Opener(): ReactNode {
  const { openBooking, openNewBooking, openChangeBooking } = useBookingOverlays();
  return (
    <>
      <button type="button" onClick={() => openNewBooking(nextPrefill)}>
        Open new
      </button>
      <button type="button" onClick={() => openChangeBooking("b-1")}>
        Open change
      </button>
      <button type="button" onClick={() => openBooking("b-1")}>
        Open details
      </button>
    </>
  );
}

async function renderApp(): Promise<void> {
  await renderWithProviders(
    <MemoryRouter initialEntries={["/bookings"]}>
      <KitRoot theme="light">
        <BookingOverlaysProvider>
          <Routes>
            <Route path="/bookings" element={<Opener />} />
            <Route path="/chats/:conversationId" element={<p>Chat page</p>} />
          </Routes>
        </BookingOverlaysProvider>
      </KitRoot>
    </MemoryRouter>,
  );
}

async function openNew(prefill: BookingFormPrefill = {}): Promise<void> {
  nextPrefill = prefill;
  await renderApp();
  await userEvent.click(page.getByRole("button", { name: "Open new" }));
}

const dialog = () => page.getByRole("dialog");
const getCalls = () => network.get.mock.calls.map(([url, config]) => ({ url, params: config?.params }));

async function openStaffList(): Promise<string[]> {
  await userEvent.click(dialog().getByRole("combobox", { name: "Staff" }));
  await expect.element(page.getByRole("listbox", { name: "Staff" })).toBeVisible();
  // Name and second line; the avatar's initials are left out.
  return [...document.querySelectorAll("[role=listbox] [role=option]")].map((option) =>
    [...option.querySelectorAll("span.block")].map((line) => line.textContent).join(" | "),
  );
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  for (const mock of Object.values(network)) mock.mockReset();
  network.get.mockImplementation((url: string, config?: { params?: Params }) => route(url, config?.params));
  server = { booking: makeBooking(), slots: SLOTS, timeOff: [] };
  useAuthStore.setState({ status: "authenticated", role: "admin" });
});

describe("New booking", () => {
  it("opens an Evaluation for a prefilled Child, offering only Admins and Managers", async () => {
    await openNew({ kind: "evaluation", childId: "c-leo", date: DAY });
    await expect.element(dialog().getByRole("heading", { name: "New booking" })).toBeVisible();
    await expect.element(dialog().getByRole("button", { name: "Evaluation" })).toHaveAttribute("aria-pressed", "true");
    await expect.element(dialog().getByRole("combobox", { name: "Child" })).toHaveValue("Leo Reis");
    const options = await openStaffList();
    expect(options).toEqual(["Dora Lima | Admin", "Eva Costa | Manager"]);
    await expect.element(dialog().getByRole("status").filter({ hasText: "Assigned Tutors" })).not.toBeInTheDocument();
  });

  it("prefills the date, start time and Staff member", async () => {
    await openNew({ childId: "c-emma", date: DAY, startTime: "15:30", userId: "u-bia" });
    await expect.element(dialog().getByLabelText("Date")).toHaveValue(DAY);
    await expect.element(dialog().getByLabelText("Start")).toHaveValue("15:30");
    await expect.element(dialog().getByLabelText("End")).toHaveValue("16:30");
    await expect.element(dialog().getByRole("combobox", { name: "Staff" })).toHaveValue("Bia Reis");
  });

  it("lists Evaluated Children for Tutoring and evaluable ones for an Evaluation", async () => {
    await openNew({ date: DAY });
    await userEvent.click(dialog().getByRole("combobox", { name: "Child" }));
    await expect.element(page.getByRole("option", { name: /Emma Souza/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Diana Souza/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(dialog().getByRole("button", { name: "Evaluation" }));
    await userEvent.click(dialog().getByRole("combobox", { name: "Child" }));
    await expect.element(page.getByRole("option", { name: /Leo Reis/ })).toBeVisible();
    await expect.element(page.getByRole("option", { name: /Grade 5 · waiting/ })).toBeVisible();
    const childLists = getCalls().filter((call) => call.url === "/api/children");
    expect(childLists.map((call) => call.params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ evaluated: true }),
        expect.objectContaining({ evaluable: true }),
      ]),
    );
  });

  it("orders and describes Staff for Tutoring from the slots and Time off", async () => {
    server.timeOff = [
      {
        id: "x-1",
        staff: { id: "u-dora", name: "Dora Lima", role: "admin" },
        start_date: DAY,
        end_date: DAY,
        start_time: null,
        end_time: null,
        status: "approved",
      },
    ];
    await openNew({ childId: "c-emma", date: DAY });
    await expect.element(dialog().getByRole("combobox", { name: "Subject" })).toBeVisible();
    await expect.poll(() => getCalls().some((call) => call.url.startsWith("/api/slots/available?"))).toBe(true);
    const options = await openStaffList();
    expect(options).toEqual([
      "Ana Souza | Assigned Tutor · Teaches Math · no free time that day",
      "Bia Reis | Teaches Math · free from 3:30 PM",
      "Dora Lima | Off Thursday (Time off)",
    ]);
  });

  it("warns when the Staff member picked isn't an Assigned Tutor", async () => {
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await expect
      .element(dialog().getByRole("status").filter({ hasText: "Bia isn’t one of Emma’s Assigned Tutors (Ana Souza)." }))
      .toBeVisible();
  });

  it("books a free-time chip with its range, and Other time switches to the time fields", async () => {
    network.post.mockResolvedValue(CREATED);
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await expect.element(dialog().getByRole("group", { name: "Free times · Bia, Thu, Oct 15" })).toBeVisible();
    const chip = dialog().getByRole("button", { name: "3:30 PM" });
    await userEvent.click(chip);
    await expect.element(chip).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(dialog().getByRole("button", { name: "Book" }));
    await expect.poll(() => network.post.mock.calls.length).toBe(1);
    const [url, body] = network.post.mock.calls[0];
    expect(url).toBe("/api/bookings");
    expect(body).toMatchObject({
      child_id: "c-emma",
      kind: "regular",
      user_id: "u-bia",
      subject_id: MATH.id,
      availability_id: "a-t-bia",
      scheduled_date: DAY,
      start_time: "15:30:00",
      end_time: "16:30:00",
      location: "home",
      home_id: "h-1",
      confirm_warnings: [],
    });
  });

  it("switches to Start and End with Other time", async () => {
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await userEvent.click(dialog().getByRole("button", { name: "Other time" }));
    await expect.element(dialog().getByLabelText("Start")).toHaveFocus();
    await userEvent.click(dialog().getByRole("button", { name: "Show free times" }));
    await expect.element(dialog().getByRole("button", { name: "3:30 PM" })).toHaveFocus();
  });

  it("shows the first 12 free times, then the rest behind Show more", async () => {
    server.slots = Array.from({ length: 14 }, (_, index) => {
      const hour = String(8 + index).padStart(2, "0");
      return makeSlot("t-bia", `${hour}:00:00`, `${hour}:30:00`);
    });
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    const group = dialog().getByRole("group", { name: "Free times · Bia, Thu, Oct 15" });
    await expect.element(group.getByRole("button", { name: "Show 2 more" })).toBeVisible();
    expect(group.element().querySelectorAll("button[aria-pressed]")).toHaveLength(12);
    await userEvent.click(group.getByRole("button", { name: "Show 2 more" }));
    await expect.element(dialog().getByRole("button", { name: "9:00 PM" })).toBeVisible();
  });

  it("falls back to the time fields when free times fail to load", async () => {
    network.get.mockImplementation((url: string, config?: { params?: Params }) =>
      url.startsWith("/api/slots/available?") ? Promise.reject(new Error("offline")) : route(url, config?.params),
    );
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await expect
      .element(dialog().getByText("Couldn’t load free times. Set a start and end time, or try again."))
      .toBeVisible();
    await expect.element(dialog().getByLabelText("Start")).toBeVisible();
  });

  it("drops a picked free time when the date changes, so Book asks for a new pick", async () => {
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await userEvent.click(dialog().getByRole("button", { name: "3:30 PM" }));
    await userEvent.fill(dialog().getByLabelText("Date"), "2099-10-16");
    await expect.element(dialog().getByRole("button", { name: "3:30 PM" })).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(dialog().getByRole("button", { name: "Book" }));
    await expect.element(dialog().getByText("Pick a free time, or set a start and end time.")).toBeVisible();
    expect(network.post).not.toHaveBeenCalled();
  });

  it("leaves the loading state when a Kind switch clears the prefilled Child", async () => {
    await openNew({ childId: "c-emma", date: DAY });
    await expect.element(dialog().getByRole("combobox", { name: "Child" })).toHaveValue("Emma Souza");
    await userEvent.click(dialog().getByRole("button", { name: "Evaluation" }));
    await expect.element(dialog().getByRole("combobox", { name: "Child" })).toHaveValue("");
    await expect.element(dialog().getByRole("status", { name: "Loading booking form" })).not.toBeInTheDocument();
    await expect.element(dialog().getByRole("button", { name: "Book" })).toBeEnabled();
  });

  it("goes back to Book when a refusal follows the warnings", async () => {
    const warnings = [{ code: "gap", message: "Too close" }];
    network.post
      .mockRejectedValueOnce(apiError(409, { detail: "x", warnings }))
      .mockRejectedValueOnce(apiError(409, { detail: "That Staff member already has a booking overlapping this time" }));
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await userEvent.click(dialog().getByRole("button", { name: "3:30 PM" }));
    await userEvent.click(dialog().getByRole("button", { name: "Book" }));
    await userEvent.click(dialog().getByRole("button", { name: "Book anyway" }));
    await expect.element(dialog().getByRole("alert").filter({ hasText: "Bia already has a booking then" })).toBeVisible();
    await expect.element(dialog().getByRole("button", { name: "Book", exact: true })).toBeVisible();
  });

  it("shows each missing field's error and focuses the first", async () => {
    await openNew({ date: DAY });
    await userEvent.click(dialog().getByRole("button", { name: "Book" }));
    await expect.element(dialog().getByText("Pick a Child.")).toBeVisible();
    await expect.element(dialog().getByText("Pick who teaches it.")).toBeVisible();
    await expect.element(dialog().getByText("Pick a free time, or set a start and end time.")).toBeVisible();
    await expect.element(dialog().getByRole("combobox", { name: "Child" })).toHaveFocus();
    expect(network.post).not.toHaveBeenCalled();
  });

  it("resends the same body with confirm_warnings after Book anyway", async () => {
    const warnings = [{ code: "gap", message: "That time is too close to another booking" }];
    network.post.mockRejectedValueOnce(apiError(409, { detail: "needs confirming", warnings })).mockResolvedValue(CREATED);
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await userEvent.click(dialog().getByRole("button", { name: "3:30 PM" }));
    await userEvent.click(dialog().getByRole("button", { name: "Book" }));
    const alert = dialog().getByRole("alert").filter({ hasText: "Check before you book" });
    await expect.element(alert).toBeVisible();
    await expect.element(alert).toHaveTextContent("That time is too close to another booking");
    await userEvent.click(dialog().getByRole("button", { name: "Book anyway" }));
    await expect.poll(() => network.post.mock.calls.length).toBe(2);
    const [first, second] = network.post.mock.calls.map((call) => call[1]);
    expect(second).toEqual({ ...first, confirm_warnings: ["gap"] });
  });

  it("clears the warnings on any edit", async () => {
    const warnings = [{ code: "gap", message: "Too close" }];
    network.post.mockRejectedValueOnce(apiError(409, { detail: "x", warnings }));
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await userEvent.click(dialog().getByRole("button", { name: "3:30 PM" }));
    await userEvent.click(dialog().getByRole("button", { name: "Book" }));
    await expect.element(dialog().getByRole("button", { name: "Book anyway" })).toBeVisible();
    await userEvent.fill(dialog().getByLabelText("Notes"), "Bring a calculator");
    await expect.element(dialog().getByRole("button", { name: "Book", exact: true })).toBeVisible();
    await expect.element(dialog().getByText("Check before you book")).not.toBeInTheDocument();
  });

  it("shows an overlap refusal inline", async () => {
    network.post.mockRejectedValue(
      apiError(409, { detail: "That Staff member already has a booking overlapping this time" }),
    );
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await userEvent.click(dialog().getByRole("button", { name: "3:30 PM" }));
    await userEvent.click(dialog().getByRole("button", { name: "Book" }));
    await expect.element(dialog().getByRole("alert").filter({ hasText: "Bia already has a booking then" })).toBeVisible();
  });

  it("closes and toasts on success, and Open opens the new Booking", async () => {
    network.post.mockResolvedValue(CREATED);
    await openNew({ childId: "c-emma", date: DAY, userId: "u-bia" });
    await userEvent.click(dialog().getByRole("button", { name: "3:30 PM" }));
    await userEvent.click(dialog().getByRole("button", { name: "Book" }));
    await expect.element(page.getByText("Booked Emma with Bia, Thu, Oct 15 at 3:30 PM.")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "New booking" })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Open", exact: true }));
    await expect.element(dialog().getByRole("button", { name: "Change booking" })).toBeVisible();
    expect(getCalls().some((call) => call.url === "/api/bookings/b-new")).toBe(true);
  });
});

describe("Change booking", () => {
  async function openChange(): Promise<void> {
    await renderApp();
    await userEvent.click(page.getByRole("button", { name: "Open change" }));
    await expect.element(dialog().getByRole("heading", { name: "Change booking" })).toBeVisible();
    await expect.element(dialog().getByLabelText("Notes")).toHaveValue("Bring the workbook");
  }

  it("locks the Child and Kind and leaves the Booking out of its own free times", async () => {
    await openChange();
    await expect.element(dialog().getByText("Child and kind stay as booked.")).toBeVisible();
    await expect.element(dialog().getByRole("combobox", { name: "Child" })).not.toBeInTheDocument();
    await expect
      .poll(() => getCalls().find((call) => call.url.startsWith("/api/slots/available?"))?.url)
      .toContain("exclude_booking_id=b-1");
  });

  it("PUTs the edits with expected_updated_at and no Child", async () => {
    network.put.mockResolvedValue({ data: makeBooking({ notes: "New notes", updated_at: FRESH_AT }) });
    await openChange();
    await userEvent.fill(dialog().getByLabelText("Notes"), "New notes");
    await userEvent.click(dialog().getByRole("button", { name: "Save changes" }));
    await expect.poll(() => network.put.mock.calls.length).toBe(1);
    const [url, body] = network.put.mock.calls[0];
    expect(url).toBe("/api/bookings/b-1");
    expect(body).toMatchObject({
      expected_updated_at: READ_AT,
      user_id: "u-ana",
      availability_id: "a-t-ana",
      start_time: "15:00:00",
      end_time: "16:00:00",
      notes: "New notes",
    });
    expect(body).not.toHaveProperty("child_id");
    expect(body).not.toHaveProperty("booked_by_guardian_id");
  });

  it("guards the save with the updated_at the form was filled from", async () => {
    network.put.mockResolvedValue({ data: makeBooking({ updated_at: FRESH_AT }) });
    await renderApp();
    await userEvent.click(page.getByRole("button", { name: "Open details" }));
    await expect.element(dialog().getByRole("button", { name: "Change booking" })).toBeVisible();
    // Someone else saves; the form's own read of it lands after it filled.
    let landFresh: (value: unknown) => void = () => {};
    network.get.mockImplementation((url: string, config?: { params?: Params }) =>
      url === "/api/bookings/b-1"
        ? new Promise((resolve) => {
            landFresh = resolve;
          })
        : route(url, config?.params),
    );
    await userEvent.click(dialog().getByRole("button", { name: "Change booking" }));
    await expect.element(dialog().getByLabelText("Notes")).toHaveValue("Bring the workbook");
    landFresh({ data: makeBooking({ notes: "Their notes", updated_at: FRESH_AT }) });
    await expect.poll(() => network.get.mock.results.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await userEvent.click(dialog().getByRole("button", { name: "Save changes" }));
    await expect.poll(() => network.put.mock.calls.length).toBe(1);
    expect(network.put.mock.calls[0][1]).toMatchObject({ expected_updated_at: READ_AT });
  });

  it("keeps the edits on a stale save, and Reload refills from a fresh read", async () => {
    network.put.mockRejectedValue(apiError(409, { detail: "That booking changed since it was opened" }));
    await openChange();
    await userEvent.fill(dialog().getByLabelText("Notes"), "My edit");
    await userEvent.click(dialog().getByRole("button", { name: "Save changes" }));
    const alert = dialog().getByRole("alert").filter({ hasText: "Someone else changed this booking" });
    await expect.element(alert).toBeVisible();
    await expect.element(dialog().getByLabelText("Notes")).toHaveValue("My edit");
    server.booking = makeBooking({ notes: "Their notes", updated_at: FRESH_AT });
    await userEvent.click(dialog().getByRole("button", { name: "Reload" }));
    await expect.element(dialog().getByLabelText("Notes")).toHaveValue("Their notes");
    await expect.element(alert).not.toBeInTheDocument();
  });

  it("offers who is free at its time when its Staff member is off", async () => {
    server.timeOff = [
      {
        id: "x-1",
        staff: { id: "u-ana", name: "Ana Souza", role: "tutor" },
        start_date: DAY,
        end_date: DAY,
        start_time: null,
        end_time: null,
        status: "approved",
      },
    ];
    server.booking = makeBooking({ start_time: "15:30:00", end_time: "16:30:00" });
    await openChange();
    await expect.element(dialog().getByText("Ana is off. Free at 3:30 PM:")).toBeVisible();
    await userEvent.click(dialog().getByRole("button", { name: "Bia Reis" }));
    await expect.element(dialog().getByRole("combobox", { name: "Staff" })).toHaveValue("Bia Reis");
  });
});

describe("from Booking details", () => {
  it("opens Change booking, and Discard returns to details with focus on the title", async () => {
    await renderApp();
    await userEvent.click(page.getByRole("button", { name: "Open details" }));
    await userEvent.click(dialog().getByRole("button", { name: "Change booking" }));
    await expect.element(dialog().getByRole("heading", { name: "Change booking" })).toBeVisible();
    await userEvent.click(dialog().getByRole("button", { name: "Discard" }));
    const title = page.getByRole("heading", { name: "Emma Souza" });
    await expect.element(title).toHaveFocus();
  });

  it("reopens details after a save and toasts with Open chat", async () => {
    network.put.mockResolvedValue({ data: makeBooking({ updated_at: FRESH_AT }) });
    await renderApp();
    await userEvent.click(page.getByRole("button", { name: "Open details" }));
    await userEvent.click(dialog().getByRole("button", { name: "Change booking" }));
    await expect.element(dialog().getByLabelText("Notes")).toHaveValue("Bring the workbook");
    await userEvent.click(dialog().getByRole("button", { name: "Save changes" }));
    await expect.element(page.getByText("Booking changed. Let Diana know.")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Emma Souza" })).toHaveFocus();
    const toast = page.getByRole("status").filter({ hasText: "Booking changed." });
    await userEvent.click(toast.getByRole("button", { name: "Open chat" }));
    await expect.element(page.getByText("Chat page")).toBeVisible();
  });
});
