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
  never,
  renderApp,
  respond,
  RITA,
  VIEWER_ID,
  ZOE,
} from "@/tests/pages/staff/staff-harness";

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 800 };
const PAGE_SIZE = 100;
const CHECKLIST_RADIUS = "20px";

const network = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
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

const SLOT = {
  id: "slot-1",
  tutor_id: "t-ana",
  day_of_week: 0,
  start_time: "15:00:00",
  end_time: "18:00:00",
  is_active: true,
  mode: "traveler",
};

const SUBJECTS = [
  { id: "s-maths", name: "Maths", archived: false },
  { id: "s-reading", name: "Reading", archived: false },
  { id: "s-science", name: "Science", archived: false },
];

// A Tutor just added: nothing set up yet.
const LIA = makeStaff({
  id: "u-lia",
  name: "Lia Moreno",
  tutor_id: "t-lia",
  email: "lia@example.com",
  sign_in_state: "not_invited",
  subjects: [],
  has_pending_time_off: false,
});

// An Admin colleague who has signed in.
const EVA = makeStaff({
  id: "u-eva",
  name: "Eva Lund",
  role: "admin",
  tutor_id: null,
  email: "eva@example.com",
  subjects: [],
  phone_number: null,
  has_pending_time_off: false,
});

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

function pageOf(items: unknown[], total = items.length): unknown {
  return { items, total, page: 1, page_size: PAGE_SIZE };
}

type Feeds = {
  staff?: StaffRead[];
  slots?: Record<string, unknown[]>;
  subjects?: () => Promise<unknown[]>;
  upcoming?: () => Promise<number>;
};

function serve({
  staff = [ANA, RITA, DAN, MO, ZOE, LIA, EVA],
  slots = { "t-ana": [SLOT] },
  subjects = async () => SUBJECTS,
  upcoming = async () => 0,
}: Feeds = {}): void {
  respond(network.get, { staff });
  const base = network.get.getMockImplementation();
  network.get.mockImplementation(async (url: string, config?: unknown) => {
    let data: unknown;
    if (url.endsWith("/availability")) {
      const tutorId = url.split("/")[3];
      data = pageOf(slots[tutorId] ?? []);
    } else if (url === "/api/subjects") {
      data = pageOf(await subjects());
    } else if (url.startsWith("/api/bookings?")) {
      data = { ...(pageOf([]) as object), total: await upcoming() };
    } else {
      return base?.(url, config);
    }
    return { data };
  });
}

const details = () => page.getByRole("dialog", { name: /^Staff: / });

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

const checklist = () => page.getByRole("region", { name: "Finish setting up" });
const menu = () => page.getByRole("dialog", { name: /^(?!Staff: )/ });
const toast = (text: string) => page.getByText(text, { exact: true });

async function openMenu(): Promise<void> {
  await details().getByRole("button", { name: "More actions" }).click();
}

function menuRow(label: string) {
  return page.getByRole("button", { name: new RegExp(`^${label}`) });
}

function expectNoHorizontalScroll(): void {
  const root = document.documentElement;
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  const panel = details().element();
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
}

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  for (const mock of Object.values(network)) mock.mockReset();
  serve();
});

afterAll(() => {
  window.history.replaceState(null, "", START_URL);
});

describe.each([
  ["1280", DESKTOP],
  ["390", PHONE],
  ["320", { width: 320, height: 800 }],
])("Setup checklist at %s", (_width, viewport) => {
  beforeEach(async () => {
    await page.viewport(viewport.width, viewport.height);
  });

  it("lists a new Tutor's three steps, each to do, with its act", async () => {
    await renderApp("/staff/u-lia");
    await expect.element(checklist()).toBeVisible();
    await expect.element(checklist().getByText("0 of 3 done")).toBeVisible();
    const items = checklist().getByRole("listitem").elements();
    expect(items.map((item) => item.textContent)).toEqual([
      "Subjects (to do)What they teach, and up to which gradeAdd subjects",
      "Availability (to do)When Guardians can book themSet availability",
      "Invite (to do)An email to lia@example.com to choose a passwordSend invite",
    ]);
    const card = checklist().element();
    expect(getComputedStyle(card).borderRadius).toBe(CHECKLIST_RADIUS);
    expectNoHorizontalScroll();
  });

  it("wraps a long email inside its row, clear of the act", async () => {
    const email = "nora.kim.with.a.long.address@example.com";
    serve({ staff: [{ ...LIA, email }] });
    await renderApp("/staff/u-lia");
    await expect.element(checklist()).toBeVisible();
    const row = checklist().getByRole("listitem").last();
    const detail = row
      .getByText(`An email to ${email} to choose a password`)
      .element();
    const act = row.getByRole("button", { name: "Send invite" }).element();
    const rowBox = row.element().getBoundingClientRect();
    const detailBox = detail.getBoundingClientRect();
    // The text itself: the link's hit area pads past it.
    const range = document.createRange();
    range.selectNodeContents(act);
    const actBox = range.getBoundingClientRect();
    expect(detail.scrollWidth).toBeLessThanOrEqual(detail.clientWidth);
    expect(detailBox.right).toBeLessThanOrEqual(rowBox.right);
    const isBeside = detailBox.right <= actBox.left;
    const isBelow = actBox.top >= detailBox.bottom;
    expect(isBeside || isBelow).toBe(true);
  });

  it("strikes done steps and drops their acts", async () => {
    serve({ staff: [{ ...LIA, subjects: [ANA.subjects[0]] }], slots: {} });
    await renderApp("/staff/u-lia");
    await expect.element(checklist().getByText("1 of 3 done")).toBeVisible();
    const subjects = checklist().getByRole("listitem").first();
    await expect.element(subjects).toHaveTextContent("Subjects (done)Maths");
    const label = subjects.getByText("Subjects").element();
    expect(getComputedStyle(label).textDecorationLine).toBe("line-through");
    expect(
      checklist().getByRole("button", { name: "Add subjects" }).elements(),
    ).toHaveLength(0);
  });

  it("switches to Availability from Set availability", async () => {
    await renderApp("/staff/u-lia");
    await checklist().getByRole("button", { name: "Set availability" }).click();
    await expect.poll(getPath).toBe("/staff/u-lia?tab=availability");
  });

  it("opens Subjects from Add subjects", async () => {
    await renderApp("/staff/u-lia");
    await checklist().getByRole("button", { name: "Add subjects" }).click();
    await expect
      .element(page.getByRole("dialog", { name: "Subjects" }))
      .toBeVisible();
  });

  it("sends the Invite from its row, holding the act while it runs", async () => {
    let finish: (value: unknown) => void = () => {};
    network.post.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await renderApp("/staff/u-lia");
    await checklist().getByRole("button", { name: "Send invite" }).click();
    expect(network.post).toHaveBeenCalledWith("/api/users/u-lia/invite");
    await expect
      .element(checklist().getByRole("button", { name: "Send invite" }))
      .toBeDisabled();
    finish({ data: { ...LIA, sign_in_state: "invited" } });
    await expect
      .element(toast("Invite sent to lia@example.com. It lasts 7 days."))
      .toBeVisible();
  });

  it("shows Availability loading with no act until the count arrives", async () => {
    respond(network.get, { staff: [LIA] });
    const base = network.get.getMockImplementation();
    network.get.mockImplementation((url: string, config?: unknown) =>
      url.endsWith("/availability") ? never() : base?.(url, config),
    );
    await renderApp("/staff/u-lia");
    await expect.element(checklist()).toBeVisible();
    expect(
      checklist().getByRole("button", { name: "Set availability" }).elements(),
    ).toHaveLength(0);
    expect(
      checklist().getByRole("button", { name: "Add subjects" }).elements(),
    ).toHaveLength(1);
  });

  it("lists only the Invite for an Admin", async () => {
    serve({ staff: [{ ...EVA, sign_in_state: "not_invited" }] });
    await renderApp("/staff/u-eva");
    await expect.element(checklist().getByText("0 of 1 done")).toBeVisible();
    expect(checklist().getByRole("listitem").elements()).toHaveLength(1);
  });

  it("is gone once every step is done", async () => {
    await renderApp("/staff/u-ana");
    await expect.element(details().getByText("Email")).toBeVisible();
    await expect
      .poll(() =>
        network.get.mock.calls.some(([url]) => url.endsWith("/availability")),
      )
      .toBe(true);
    await expect.element(checklist()).not.toBeInTheDocument();
  });

  it("isn't shown to Managers, nor are the account acts", async () => {
    await renderApp("/staff/u-lia", "manager");
    await expect.element(details().getByText("Email")).toBeVisible();
    await expect.element(checklist()).not.toBeInTheDocument();
    expect(
      details().getByRole("button", { name: "Edit" }).elements(),
    ).toHaveLength(0);
    expect(
      details().getByRole("button", { name: "More actions" }).elements(),
    ).toHaveLength(0);
    expect(
      details().getByRole("button", { name: "Edit subjects" }).elements(),
    ).toHaveLength(0);
  });
});

describe("Edit", () => {
  const sheet = () => page.getByRole("dialog", { name: /^Edit / });

  it("offers Tutor ↔ Manager and the teaching profile on a Tutor", async () => {
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(sheet()).toHaveAccessibleName("Edit Ana Brooks");
    expect(sheet().getByRole("radio").elements()).toHaveLength(2);
    await expect
      .element(sheet().getByRole("radio", { name: /Tutor/ }))
      .toBeChecked();
    await expect
      .element(sheet().getByLabelText("Phone"))
      .toHaveValue("+13055550142");
    await expect.element(sheet().getByLabelText("Bio")).toBeVisible();
    await expect
      .element(sheet().getByText("They sign in with it, and Invites go here."))
      .toBeVisible();
  });

  it("gives an Admin the role note instead of Role, and no profile", async () => {
    await renderApp(`/staff/${VIEWER_ID}`);
    await details().getByRole("button", { name: "Edit", exact: true }).click();
    await expect.element(sheet()).toBeVisible();
    expect(sheet().getByRole("radio").elements()).toHaveLength(0);
    await expect
      .element(
        sheet().getByText(
          "An Admin’s role can’t change. To move someone in or out of Admin, archive them and add them again.",
        ),
      )
      .toBeVisible();
    expect(sheet().getByLabelText("Phone").elements()).toHaveLength(0);
  });

  it("is off on another Admin", async () => {
    await renderApp("/staff/u-eva");
    await expect
      .element(details().getByRole("button", { name: "Edit", exact: true }))
      .toBeDisabled();
  });

  it("saves the account, then the profile", async () => {
    network.patch.mockResolvedValue({ data: ANA });
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit", exact: true }).click();
    await sheet()
      .getByRole("radio", { name: /Manager/ })
      .click();
    await sheet().getByLabelText("Name").fill("Ana B. Brooks");
    await sheet().getByLabelText("Phone").fill("+13055550199");
    await sheet().getByRole("button", { name: "Save" }).click();
    await expect.element(toast("Saved.")).toBeVisible();
    expect(network.patch.mock.calls).toEqual([
      ["/api/users/u-ana", { name: "Ana B. Brooks", role: "manager" }],
      ["/api/tutors/t-ana", { phone_number: "+13055550199" }],
    ]);
    await expect.element(sheet()).not.toBeInTheDocument();
  });

  it("keeps the sheet open when only the profile fails", async () => {
    network.patch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/tutors/")) throw refusal(500, "boom");
      return { data: ANA };
    });
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit", exact: true }).click();
    await sheet().getByLabelText("Name").fill("Ana B. Brooks");
    await sheet().getByLabelText("Bio").fill("Loves fractions.");
    await sheet().getByRole("button", { name: "Save" }).click();
    await expect
      .element(sheet().getByRole("alert"))
      .toHaveTextContent(
        "Saved their name, email and role, but not their phone and bio. Try again.",
      );
    expect(network.patch).toHaveBeenCalledTimes(2);
  });

  it("scrolls the partial-failure alert into view on a short screen", async () => {
    await page.viewport(PHONE.width, 560);
    network.patch.mockImplementation(async (url: string) => {
      if (url.startsWith("/api/tutors/")) throw refusal(500, "boom");
      return { data: ANA };
    });
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit", exact: true }).click();
    await sheet().getByLabelText("Name").fill("Ana B. Brooks");
    await sheet().getByLabelText("Bio").fill("Loves fractions.");
    await sheet().getByLabelText("Name").click();
    await sheet().getByRole("button", { name: "Save" }).click();
    const alert = sheet().getByRole("alert");
    await expect.element(alert).toBeInTheDocument();
    await expect.poll(() => isInSheetView(alert.element())).toBe(true);
  });

  it("explains why a Manager with no teaching profile can't become a Tutor", async () => {
    serve({ staff: [{ ...MO, tutor_id: null }] });
    network.patch.mockRejectedValue(
      refusal(
        400,
        "A tutor or manager account requires a tutor profile, any other role must have none",
      ),
    );
    await renderApp("/staff/u-mo");
    await details().getByRole("button", { name: "Edit", exact: true }).click();
    await sheet().getByRole("radio", { name: /Tutor/ }).click();
    await sheet().getByRole("button", { name: "Save" }).click();
    await expect
      .element(sheet().getByRole("alert"))
      .toHaveTextContent(
        "They have no teaching profile, so they can’t be a Tutor.",
      );
  });

  it("saves nothing when the account is refused", async () => {
    network.patch.mockRejectedValue(
      refusal(409, "A user with that email already exists"),
    );
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit", exact: true }).click();
    await sheet().getByLabelText("Email").fill("rita@example.com");
    await sheet().getByLabelText("Bio").fill("Loves fractions.");
    await sheet().getByRole("button", { name: "Save" }).click();
    await expect
      .element(sheet().getByText("Someone on Staff already uses this email."))
      .toBeVisible();
    expect(network.patch).toHaveBeenCalledOnce();
  });

  it("shows the lock reason on a 403", async () => {
    network.patch.mockRejectedValue(
      refusal(403, "Only a developer may modify another admin's account"),
    );
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit", exact: true }).click();
    await sheet().getByLabelText("Name").fill("Ana B. Brooks");
    await sheet().getByRole("button", { name: "Save" }).click();
    await expect
      .element(sheet().getByRole("alert"))
      .toHaveTextContent(
        "Only a developer can change another Admin’s account.",
      );
  });

  it("stacks the footer with Save on top at 390", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit", exact: true }).click();
    const save = sheet().getByRole("button", { name: "Save" }).element();
    const cancel = sheet().getByRole("button", { name: "Cancel" }).element();
    expect(save.getBoundingClientRect().top).toBeLessThan(
      cancel.getBoundingClientRect().top,
    );
  });
});

describe("Subjects", () => {
  const sheet = () => page.getByRole("dialog", { name: "Subjects" });

  async function openSubjects(): Promise<void> {
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit subjects" }).click();
    await expect.element(sheet().getByText("Science")).toBeVisible();
  }

  it("ticks their Subjects with each highest grade", async () => {
    await openSubjects();
    await expect
      .element(sheet().getByRole("checkbox", { name: "Maths" }))
      .toBeChecked();
    await expect
      .element(sheet().getByRole("checkbox", { name: "Science" }))
      .not.toBeChecked();
    await expect
      .element(sheet().getByRole("combobox", { name: "Maths: highest grade" }))
      .toHaveTextContent("Grade 8");
    await expect
      .element(
        sheet().getByRole("combobox", { name: "Reading: highest grade" }),
      )
      .toHaveTextContent("Kindergarten");
    expect(
      sheet()
        .getByRole("combobox", { name: "Science: highest grade" })
        .elements(),
    ).toHaveLength(0);
  });

  it("offers Kindergarten to Grade 12, Grade 5 for a new tick", async () => {
    await openSubjects();
    await sheet().getByRole("checkbox", { name: "Science" }).click();
    const science = sheet().getByRole("combobox", {
      name: "Science: highest grade",
    });
    await expect.element(science).toHaveTextContent("Grade 5");
    await science.click();
    const options = page
      .getByRole("option")
      .elements()
      .map((option) => option.textContent);
    expect(options).toEqual([
      "Kindergarten",
      ...Array.from({ length: 12 }, (_, index) => `Grade ${index + 1}`),
    ]);
  });

  it("sends only the difference, a new grade as remove then add", async () => {
    network.delete.mockResolvedValue({ data: null });
    network.post.mockResolvedValue({ data: {} });
    await openSubjects();
    await sheet().getByRole("checkbox", { name: "Reading" }).click();
    await sheet().getByRole("checkbox", { name: "Science" }).click();
    await sheet()
      .getByRole("combobox", { name: "Maths: highest grade" })
      .click();
    await page.getByRole("option", { name: "Grade 6" }).click();
    await sheet().getByRole("button", { name: "Save subjects" }).click();
    await expect.element(toast("Subjects saved.")).toBeVisible();
    expect(network.delete.mock.calls).toEqual([
      ["/api/tutors/t-ana/subjects/s-maths"],
      ["/api/tutors/t-ana/subjects/s-reading"],
    ]);
    expect(network.post.mock.calls).toEqual([
      [
        "/api/tutors/t-ana/subjects",
        { subject_id: "s-maths", max_grade_level: 6 },
      ],
      [
        "/api/tutors/t-ana/subjects",
        { subject_id: "s-science", max_grade_level: 5 },
      ],
    ]);
  });

  it("finishes each new grade before the next call, so a failure can't drop it", async () => {
    network.post.mockResolvedValue({ data: {} });
    network.delete.mockImplementation(async (url: string) => {
      if (url.endsWith("/s-reading")) throw refusal(500, "boom");
      return { data: null };
    });
    await openSubjects();
    await sheet().getByRole("checkbox", { name: "Reading" }).click();
    await sheet()
      .getByRole("combobox", { name: "Maths: highest grade" })
      .click();
    await page.getByRole("option", { name: "Grade 6" }).click();
    await sheet().getByRole("button", { name: "Save subjects" }).click();
    await expect.element(sheet().getByRole("alert")).toBeVisible();
    expect(network.post.mock.calls).toEqual([
      [
        "/api/tutors/t-ana/subjects",
        { subject_id: "s-maths", max_grade_level: 6 },
      ],
    ]);
    const [mathsRemoved, readingRemoved] =
      network.delete.mock.invocationCallOrder;
    const [mathsAdded] = network.post.mock.invocationCallOrder;
    expect(mathsRemoved).toBeLessThan(mathsAdded);
    expect(mathsAdded).toBeLessThan(readingRemoved);
  });

  it("holds Save when there are no Subjects to pick", async () => {
    serve({ subjects: async () => [] });
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit subjects" }).click();
    await expect
      .element(sheet().getByText("No Subjects to pick from yet."))
      .toBeVisible();
    await expect
      .element(sheet().getByRole("button", { name: "Save subjects" }))
      .toBeDisabled();
  });

  it("stays open with an alert when some don't save", async () => {
    network.post.mockRejectedValue(refusal(500, "boom"));
    await openSubjects();
    await sheet().getByRole("checkbox", { name: "Science" }).click();
    await sheet().getByRole("button", { name: "Save subjects" }).click();
    await expect
      .element(sheet().getByRole("alert"))
      .toHaveTextContent(
        "Some subjects didn’t save. Check them and try again.",
      );
    await expect
      .element(sheet().getByRole("checkbox", { name: "Science" }))
      .not.toBeChecked();
  });

  it("shows row skeletons while the Subjects load", async () => {
    serve({ subjects: never });
    await renderApp("/staff/u-ana");
    await details().getByRole("button", { name: "Edit subjects" }).click();
    await expect
      .element(sheet().getByRole("status", { name: "Loading Subjects" }))
      .toBeVisible();
    await expect
      .element(sheet().getByRole("button", { name: "Save subjects" }))
      .toBeDisabled();
  });
});

describe("More actions", () => {
  async function openMenuOn(path: string): Promise<void> {
    await renderApp(path);
    await openMenu();
    await expect.element(menu()).toBeVisible();
  }

  function rowLabels(): string[] {
    return menu()
      .getByRole("button")
      .elements()
      .filter((button) => button.hasAttribute("data-more-row"))
      .map((button) => button.textContent ?? "");
  }

  it("offers reset and Archive on an active Tutor", async () => {
    await openMenuOn("/staff/u-ana");
    await expect.element(menu()).toHaveAccessibleName("Ana Brooks");
    expect(rowLabels()).toEqual([
      "Send password resetTo ana@example.com",
      "ArchiveThey can’t sign in or be booked",
    ]);
  });

  it("offers Send invite while Not invited, again while Invited", async () => {
    await openMenuOn("/staff/u-mo");
    expect(rowLabels()[0]).toBe("Send inviteTo mo@example.com");
    await userEvent.keyboard("{Escape}");
    await page
      .getByRole("button", { name: "Close", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: "Open Dan Moss" }).click();
    await openMenu();
    expect(rowLabels()[0]).toBe("Send invite againTo dan@example.com");
  });

  it("locks another Admin's reset and Archive, saying why", async () => {
    await openMenuOn("/staff/u-eva");
    const lock = "Only a developer can change another Admin’s account.";
    await expect.element(menuRow("Send password reset")).toBeDisabled();
    await expect
      .element(menuRow("Send password reset"))
      .toHaveTextContent(lock);
    await expect.element(menuRow("Archive")).toBeDisabled();
    await expect.element(menuRow("Archive")).toHaveTextContent(lock);
  });

  it("locks Archive on yourself", async () => {
    await openMenuOn(`/staff/${VIEWER_ID}`);
    await expect.element(menuRow("Archive")).toBeDisabled();
    await expect
      .element(menuRow("Archive"))
      .toHaveTextContent("You can’t archive yourself.");
  });

  it("sends the Invite", async () => {
    network.post.mockResolvedValue({ data: MO });
    await openMenuOn("/staff/u-mo");
    await menuRow("Send invite").click();
    await expect
      .element(toast("Invite sent to mo@example.com. It lasts 7 days."))
      .toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/users/u-mo/invite");
  });

  it("says when the Invite didn't send", async () => {
    network.post.mockRejectedValue(
      refusal(502, "Could not send the invite email. Try again."),
    );
    await openMenuOn("/staff/u-mo");
    await menuRow("Send invite").click();
    await expect
      .element(toast("Couldn’t send the Invite. Try again."))
      .toBeVisible();
  });

  it("sends a password reset", async () => {
    network.post.mockResolvedValue({ data: null });
    await openMenuOn("/staff/u-ana");
    await menuRow("Send password reset").click();
    await expect
      .element(toast("Password reset sent to ana@example.com."))
      .toBeVisible();
    expect(network.post).toHaveBeenCalledWith(
      "/api/users/u-ana/password-reset",
    );
  });

  it("says when the reset email didn't send", async () => {
    network.post.mockRejectedValue(
      refusal(502, "Could not send the reset email. Try again."),
    );
    await openMenuOn("/staff/u-ana");
    await menuRow("Send password reset").click();
    await expect
      .element(toast("Couldn’t send the reset email. Try again."))
      .toBeVisible();
  });

  it("restores archived Staff with no confirm", async () => {
    network.post.mockResolvedValue({ data: {} });
    await openMenuOn("/staff/u-zoe");
    expect(rowLabels()).toEqual(["RestoreThey sign in as before"]);
    await menuRow("Restore").click();
    await expect.element(toast("Zoe Park restored.")).toBeVisible();
    expect(network.post).toHaveBeenCalledWith("/api/restore", {
      type: "staff",
      id: "u-zoe",
    });
  });
});

describe("Archive", () => {
  const dialog = () =>
    page.getByRole("alertdialog", { name: "Archive Ana Brooks?" });
  const ANA_WITH_CHILDREN = {
    ...ANA,
    assigned_children: [
      { id: "c-1", name: "Leo" },
      { id: "c-2", name: "Mia" },
    ],
  };

  async function askToArchive(): Promise<void> {
    await renderApp("/staff/u-ana");
    await openMenu();
    await menuRow("Archive").click();
    await expect.element(dialog()).toBeVisible();
  }

  it("names the waiting Bookings and lost Children", async () => {
    serve({ staff: [ANA_WITH_CHILDREN], upcoming: async () => 3 });
    await askToArchive();
    await expect
      .element(dialog())
      .toHaveTextContent(
        "3 upcoming Bookings are with them. Nothing is cancelled: they wait in To do for you to Change booking.",
      );
    await expect
      .element(dialog())
      .toHaveTextContent(
        "They stop being an Assigned Tutor of 2 Children. Restore doesn’t bring that back.",
      );
    await expect
      .element(dialog())
      .toHaveTextContent(
        "They can’t sign in or be booked any more. Restore brings them back.",
      );
    const reads = network.get.mock.calls.map(([url]) => url as string);
    const countRead =
      reads.find((url) => url.startsWith("/api/bookings?")) ?? "";
    const params = new URLSearchParams(countRead.split("?")[1]);
    expect(params.getAll("user_id")).toEqual(["u-ana"]);
    expect(params.getAll("status")).toEqual(["pending", "confirmed"]);
    expect(params.get("from")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("words one waiting Booking in the singular", async () => {
    serve({ upcoming: async () => 1 });
    await askToArchive();
    await expect
      .element(dialog())
      .toHaveTextContent(
        "1 upcoming Booking is with them. Nothing is cancelled: it waits in To do for you to Change booking.",
      );
  });

  it("holds the confirm until the count is in", async () => {
    serve({ upcoming: never });
    await askToArchive();
    await expect
      .element(dialog().getByRole("button", { name: "Archive" }))
      .toBeDisabled();
    expect(dialog().element().querySelector("[aria-busy=true]")).not.toBeNull();
  });

  it("says when the count couldn't load, and retries", async () => {
    let calls = 0;
    serve({
      upcoming: async () => {
        calls += 1;
        if (calls === 1) throw refusal(500, "boom");
        return 0;
      },
    });
    await askToArchive();
    await expect
      .element(dialog().getByRole("alert"))
      .toHaveTextContent("Couldn’t check their upcoming Bookings.");
    await expect
      .element(dialog().getByRole("button", { name: "Archive" }))
      .toBeDisabled();
    await dialog().getByRole("button", { name: "Try again" }).click();
    await expect
      .element(dialog().getByRole("button", { name: "Archive" }))
      .toBeEnabled();
  });

  it("archives with the warning confirmed, and offers no Undo", async () => {
    const staff = [ANA];
    serve({ staff, upcoming: async () => 3 });
    network.post.mockImplementation(async () => {
      staff[0] = { ...ANA, archived: true };
      return { data: {} };
    });
    await askToArchive();
    await dialog().getByRole("button", { name: "Archive" }).click();
    expect(network.post).toHaveBeenCalledWith("/api/archive", {
      type: "staff",
      id: "u-ana",
      confirm_warnings: ["archived_staff_bookings"],
    });
    await expect
      .element(toast("Ana Brooks archived. 3 Bookings wait in To do."))
      .toBeVisible();
    expect(page.getByRole("button", { name: "Undo" }).elements()).toHaveLength(
      0,
    );
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(details().getByText("Archived", { exact: true }))
      .toBeVisible();
    await expect
      .element(details().getByRole("button", { name: "Edit", exact: true }))
      .toBeDisabled();
  });

  it("says just archived when nothing waits", async () => {
    network.post.mockResolvedValue({ data: {} });
    await askToArchive();
    await dialog().getByRole("button", { name: "Archive" }).click();
    await expect.element(toast("Ana Brooks archived.")).toBeVisible();
  });

  it("shows the lock reason in the dialog on a 403", async () => {
    network.post.mockRejectedValue(
      refusal(403, "Only a developer may modify another admin's account"),
    );
    await askToArchive();
    await dialog().getByRole("button", { name: "Archive" }).click();
    await expect
      .element(dialog().getByRole("alert"))
      .toHaveTextContent(
        "Only a developer can change another Admin’s account.",
      );
  });

  it("shows any other failure in the dialog", async () => {
    network.post.mockRejectedValue(refusal(500, "boom"));
    await askToArchive();
    await dialog().getByRole("button", { name: "Archive" }).click();
    await expect
      .element(dialog().getByRole("alert"))
      .toHaveTextContent(
        "Couldn’t archive them. Check your connection and try again.",
      );
  });
});
