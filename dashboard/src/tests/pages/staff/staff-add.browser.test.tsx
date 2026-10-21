import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse } from "axios";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { StaffRead } from "@/lib/queries/staff";
import {
  ANA,
  DAN,
  getPath,
  makeStaff,
  MO,
  renderApp,
  respond,
  RITA,
  ZOE,
} from "@/tests/pages/staff/staff-harness";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 800 };

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: network,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

const START_URL = window.location.href;

function refusal(status: number, detail: string): AxiosError {
  const response = {
    status,
    statusText: "Refused",
    data: { detail },
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
  return new AxiosError(
    detail,
    "ERR_BAD_REQUEST",
    undefined,
    undefined,
    response,
  );
}

let staff: StaffRead[] = [];

function makeCreated(body: {
  name: string;
  email: string;
  role: StaffRead["role"];
}): StaffRead {
  return makeStaff({
    id: "u-new",
    name: body.name,
    email: body.email,
    role: body.role,
    tutor_id: body.role === "admin" ? null : "t-new",
    sign_in_state: "not_invited",
    subjects: [],
    sessions_this_week: 0,
    has_pending_time_off: false,
  });
}

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  staff = [ANA, RITA, DAN, MO, ZOE];
  network.get.mockReset();
  network.post.mockReset();
  respond(network.get, { staff });
  network.post.mockImplementation(async (url: string, body: StaffRead) => {
    if (url !== "/api/users") throw refusal(404, "Not found");
    const created = makeCreated(body);
    staff.push(created);
    return { data: created };
  });
});

afterAll(() => {
  window.history.replaceState(null, "", START_URL);
});

const sheet = () => page.getByRole("dialog", { name: "Add staff" });

// The element sits inside the visible part of the sheet's scrolling body.
function isInSheetView(element: Element): boolean {
  let body = element.parentElement;
  while (body && getComputedStyle(body).overflowY !== "auto") {
    body = body.parentElement;
  }
  const box = element.getBoundingClientRect();
  const view = (body ?? document.documentElement).getBoundingClientRect();
  // A pixel of slack for fractional layout.
  return box.top >= view.top - 1 && box.bottom <= view.bottom + 1;
}

async function openAddStaff(path = "/staff"): Promise<void> {
  await renderApp(path);
  await page.getByRole("button", { name: "Add staff" }).click();
  await expect.element(sheet()).toBeVisible();
}

async function fillTutor(): Promise<void> {
  await sheet().getByLabelText("Name").fill("Lia Moreno");
  await sheet().getByLabelText("Email").fill("lia@example.com");
  await sheet().getByLabelText("Phone").fill("+1 305 555 0199");
}

function submit(): Promise<void> {
  return sheet().getByRole("button", { name: "Add staff" }).click();
}

describe("Add staff", () => {
  it("asks for a Phone from Tutors and Managers, not Admins", async () => {
    await openAddStaff();
    await expect
      .element(
        sheet().getByText(
          "You’ll set up their Subjects and Availability next.",
        ),
      )
      .toBeVisible();
    await expect
      .element(sheet().getByRole("radio", { name: /Tutor/ }))
      .toBeChecked();
    await expect.element(sheet().getByLabelText("Phone")).toBeVisible();
    await sheet().getByRole("radio", { name: /Admin/ }).click();
    await expect
      .element(sheet().getByLabelText("Phone"))
      .not.toBeInTheDocument();
    await sheet()
      .getByRole("radio", { name: /Manager/ })
      .click();
    await expect.element(sheet().getByLabelText("Phone")).toBeVisible();
    await expect
      .element(sheet().getByRole("switch", { name: "Send invite now" }))
      .toBeChecked();
  });

  it("names every missing field on submit and focuses the first", async () => {
    await openAddStaff();
    await submit();
    await expect.element(sheet().getByText("Enter their name.")).toBeVisible();
    await expect
      .element(
        sheet().getByText("Enter an email address. Their Invite goes here."),
      )
      .toBeVisible();
    await expect
      .element(sheet().getByText("Enter a phone number."))
      .toBeVisible();
    await expect.element(sheet().getByLabelText("Name")).toHaveFocus();
    expect(network.post).not.toHaveBeenCalled();
  });

  it("clears a fixed field's error on blur after the first submit", async () => {
    await openAddStaff();
    await submit();
    await sheet().getByLabelText("Name").fill("Lia Moreno");
    await userEvent.tab();
    await expect
      .element(sheet().getByText("Enter their name."))
      .not.toBeInTheDocument();
    await expect
      .element(sheet().getByText("Enter a phone number."))
      .toBeVisible();
  });

  it.each([
    [
      409,
      "A user with that email already exists",
      "Email",
      "Someone on Staff already uses this email.",
    ],
    [
      409,
      "A tutor with that phone number already exists",
      "Phone",
      "Another Staff member already uses this phone number.",
    ],
    [
      400,
      "tutor.phone_number is not a phone number that can be dialled",
      "Phone",
      "Enter a phone number that can be dialled.",
    ],
  ])(
    "shows a %i (%s) under its field",
    async (status, detail, field, message) => {
      network.post.mockRejectedValue(refusal(status, detail));
      await openAddStaff();
      await fillTutor();
      await submit();
      await expect.element(sheet().getByText(message)).toBeVisible();
      await expect
        .element(sheet().getByLabelText(field))
        .toHaveAttribute("aria-invalid", "true");
      await expect.element(sheet().getByLabelText(field)).toHaveFocus();
    },
  );

  it("shows any other failure as a form alert and stays open", async () => {
    network.post.mockRejectedValue(refusal(500, "boom"));
    await openAddStaff();
    await fillTutor();
    await submit();
    await expect
      .element(sheet().getByRole("alert"))
      .toHaveTextContent(
        "Couldn’t add them. Check your connection and try again.",
      );
  });

  it("scrolls the form alert into view on a short screen", async () => {
    await page.viewport(PHONE.width, 560);
    network.post.mockRejectedValue(refusal(500, "boom"));
    await openAddStaff();
    await fillTutor();
    await submit();
    const alert = sheet().getByRole("alert");
    await expect.element(alert).toBeInTheDocument();
    await expect.poll(() => isInSheetView(alert.element())).toBe(true);
  });

  it("blocks closing while it saves", async () => {
    let finish: (value: unknown) => void = () => {};
    network.post.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await openAddStaff();
    await fillTutor();
    await submit();
    await expect
      .element(sheet().getByRole("button", { name: "Cancel" }))
      .toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(sheet()).toBeVisible();
    finish({
      data: makeCreated({
        name: "Lia Moreno",
        email: "lia@example.com",
        role: "tutor",
      }),
    });
  });

  it("adds a Tutor with the Invite, then opens their details on the Staff tab", async () => {
    await openAddStaff("/staff?list=archived");
    await fillTutor();
    await submit();
    expect(network.post).toHaveBeenCalledWith("/api/users", {
      email: "lia@example.com",
      name: "Lia Moreno",
      role: "tutor",
      send_invite: true,
      tutor: { phone_number: "+1 305 555 0199" },
    });
    await expect
      .element(
        page.getByText("Lia Moreno added. Invite sent to lia@example.com."),
      )
      .toBeVisible();
    await expect.poll(getPath).toBe("/staff/u-new");
    await expect
      .element(page.getByRole("dialog", { name: "Staff: Lia Moreno" }))
      .toBeVisible();
  });

  it("adds an Admin without the Invite", async () => {
    await openAddStaff();
    await sheet().getByRole("radio", { name: /Admin/ }).click();
    await sheet().getByLabelText("Name").fill("Bo Diaz");
    await sheet().getByLabelText("Email").fill("bo@example.com");
    await sheet().getByRole("switch", { name: "Send invite now" }).click();
    await submit();
    expect(network.post).toHaveBeenCalledWith("/api/users", {
      email: "bo@example.com",
      name: "Bo Diaz",
      role: "admin",
      send_invite: false,
    });
    await expect
      .element(page.getByText("Bo Diaz added.", { exact: true }))
      .toBeVisible();
    await expect.poll(getPath).toBe("/staff/u-new");
  });

  it("keeps the Role cards in one column", async () => {
    await openAddStaff();
    const lefts = sheet()
      .getByRole("radio")
      .elements()
      .map((radio) => radio.getBoundingClientRect().left);
    expect(new Set(lefts).size).toBe(1);
  });

  it("isn't offered to Managers", async () => {
    await renderApp("/staff", "manager");
    await expect
      .element(page.getByText("View only. Admins add and change Staff."))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Add staff" }))
      .not.toBeInTheDocument();
  });
});

describe("Add staff at 390", () => {
  beforeEach(async () => {
    await page.viewport(PHONE.width, PHONE.height);
  });

  it("stacks the footer with Add staff on top, Role cards in one column", async () => {
    await openAddStaff();
    const primary = sheet()
      .getByRole("button", { name: "Add staff" })
      .element();
    const cancel = sheet().getByRole("button", { name: "Cancel" }).element();
    expect(primary.getBoundingClientRect().top).toBeLessThan(
      cancel.getBoundingClientRect().top,
    );
    const lefts = sheet()
      .getByRole("radio")
      .elements()
      .map((radio) => radio.getBoundingClientRect().left);
    expect(new Set(lefts).size).toBe(1);
  });

  it("adds a Tutor and opens their details", async () => {
    await openAddStaff();
    await fillTutor();
    await submit();
    await expect.poll(getPath).toBe("/staff/u-new");
  });
});
