import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import type { AxiosResponse } from "axios";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { EvaluatedChild } from "@/lib/queries/assigned-children";
import type { StaffRead } from "@/lib/queries/staff";
import {
  ANA,
  getPath,
  makeStaff,
  MO,
  never,
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
  delete: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get, post: network.post, delete: network.delete },
}));

// The bootstrap refresh is the auth flow's business; tests set the session.
vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
}));

const START_URL = window.location.href;

const ANA_REF = { id: ANA.id, name: ANA.name, role: "tutor" as const };
const MO_REF = { id: MO.id, name: MO.name, role: "manager" as const };

function makeChild(overrides: Partial<EvaluatedChild>): EvaluatedChild {
  return {
    id: "c-x",
    name: "Child X",
    archived: false,
    guardians: [],
    levels: [],
    assigned_tutors: [],
    ...overrides,
  };
}

const EMMA = makeChild({
  id: "c-emma",
  name: "Emma Garcia",
  guardians: [{ id: "g-lucia", name: "Lucia Garcia" }],
  levels: [{ subject_id: "s-maths", name: "Maths", level: 5 }],
  assigned_tutors: [ANA_REF],
});
const LEO = makeChild({
  id: "c-leo",
  name: "Leo Park",
  archived: true,
  guardians: [{ id: "g-min", name: "Min Park" }],
  levels: [{ subject_id: "s-reading", name: "Reading", level: 4 }],
  assigned_tutors: [ANA_REF],
});
const SOFIA = makeChild({
  id: "c-sofia",
  name: "Sofia Reyes",
  guardians: [
    { id: "g-maria", name: "Maria Martinez" },
    { id: "g-juan", name: "Juan Reyes" },
  ],
  levels: [
    { subject_id: "s-maths", name: "Maths", level: 3 },
    { subject_id: "s-reading", name: "Reading", level: 2 },
  ],
  assigned_tutors: [ANA_REF, MO_REF],
});
const TOM = makeChild({
  id: "c-tom",
  name: "Tom Lee",
  guardians: [{ id: "g-kim", name: "Kim Lee" }],
  levels: [{ subject_id: "s-maths", name: "Maths", level: 2 }],
  assigned_tutors: [MO_REF],
});

const ANA_WITH_CHILDREN = makeStaff({
  assigned_children: [EMMA, SOFIA].map(({ id, name }) => ({ id, name })),
});

function makeError(status: number): AxiosError {
  const response = {
    status,
    statusText: "Error",
    data: { detail: "Refused" },
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as AxiosResponse;
  return new AxiosError("Refused", "ERR_BAD_REQUEST", undefined, undefined, response);
}

type Server = {
  children: EvaluatedChild[];
  // Replaces the Children read, e.g. to fail or hang it.
  read?: () => Promise<unknown>;
  // A write to this Child is refused with this status.
  refuse?: { childId: string; status: number };
};

let server: Server;

function readChildren(params: { archived: boolean; page: number }): unknown {
  const items = server.children
    .filter((child) => child.archived === params.archived)
    .map((child) => structuredClone(child));
  return { items, total: items.length, page: params.page, page_size: 100 };
}

function findChild(url: string): EvaluatedChild {
  const childId = url.split("/")[3];
  const child = server.children.find((item) => item.id === childId);
  if (!child) throw makeError(404);
  if (server.refuse?.childId === childId) throw makeError(server.refuse.status);
  return child;
}

const TUTORS = [ANA_REF, MO_REF];

function serve(staff: StaffRead[] = [ANA_WITH_CHILDREN, RITA, MO, ZOE]): void {
  respond(network.get, { staff });
  const staffAndShell = network.get.getMockImplementation();
  network.get.mockImplementation(
    async (url: string, config?: { params?: unknown }) => {
      if (url !== "/api/children") return staffAndShell?.(url, config);
      if (server.read) return { data: await server.read() };
      return { data: readChildren(config?.params as { archived: boolean; page: number }) };
    },
  );
  network.post.mockImplementation(
    async (url: string, body: { user_id: string }) => {
      const child = findChild(url);
      const tutor = TUTORS.find((item) => item.id === body.user_id);
      if (tutor) child.assigned_tutors = [...child.assigned_tutors, tutor];
      return { data: child.assigned_tutors };
    },
  );
  network.delete.mockImplementation(async (url: string) => {
    const child = findChild(url);
    const userId = url.split("/").at(-1);
    child.assigned_tutors = child.assigned_tutors.filter((item) => item.id !== userId);
    return { data: null };
  });
}

function getTutorIds(childId: string): string[] {
  return (
    server.children
      .find((child) => child.id === childId)
      ?.assigned_tutors.map((tutor) => tutor.id) ?? []
  );
}

function getWriteUrls(): string[] {
  return [
    ...network.post.mock.calls.map(([url, body]) => `POST ${url} ${body.user_id}`),
    ...network.delete.mock.calls.map(([url]) => `DELETE ${url}`),
  ].sort();
}

const details = () => page.getByRole("dialog", { name: /^Staff:/ });
const sheet = () => page.getByRole("dialog", { name: "Ana’s Children" });
const card = (name: string) =>
  details().getByRole("button", { name: new RegExp(`^${name}`) });

async function openSheet(): Promise<void> {
  await details().getByRole("button", { name: "Change" }).click();
  await expect.element(sheet().getByRole("checkbox", { name: /Emma Garcia/ })).toBeVisible();
}

beforeEach(async () => {
  await page.viewport(DESKTOP.width, DESKTOP.height);
  network.get.mockReset();
  network.post.mockReset();
  network.delete.mockReset();
  server = { children: structuredClone([EMMA, LEO, SOFIA, TOM]) };
  serve();
});

afterAll(() => {
  window.history.replaceState(null, "", START_URL);
});

describe.each([
  ["1280", DESKTOP],
  ["390", PHONE],
])("Staff › Children at %s", (_, size) => {
  beforeEach(async () => {
    await page.viewport(size.width, size.height);
  });

  it("lists their Children with family, coverage and badges", async () => {
    await renderApp("/staff/u-ana?tab=children");
    await expect
      .element(details().getByRole("heading", { name: "Assigned Children · 2" }))
      .toBeVisible();
    await expect.element(card("Emma Garcia")).toHaveTextContent(
      "Garcia family · Covers Maths Grade 5",
    );
    await expect.element(card("Emma Garcia")).toHaveTextContent("Only Assigned Tutor");
    await expect.element(card("Sofia Reyes")).toHaveTextContent(
      "Martinez & Reyes family · Covers Maths · not Reading",
    );
    await expect.element(card("Sofia Reyes")).not.toHaveTextContent("Only Assigned Tutor");
    await expect.element(card("Leo Park")).toHaveTextContent(
      "Park family · Doesn’t cover Reading Grade 4",
    );
    await expect.element(card("Leo Park")).toHaveTextContent("Archived");
    await expect.element(card("Leo Park")).not.toHaveTextContent("Only Assigned Tutor");
    expect(details().getByRole("button", { name: /Tom Lee/ }).elements()).toHaveLength(0);
    await expect
      .element(
        details().getByText(
          "The bot may book these Children with Ana, for the Subject levels Ana covers. Ana doesn’t see this list.",
        ),
      )
      .toBeVisible();
  });

  it("opens a Child in their family", async () => {
    await renderApp("/staff/u-ana?tab=children");
    await card("Emma Garcia").click();
    await expect.poll(getPath).toBe("/families/c-emma?child=c-emma");
  });

  it("says when they are no one's Assigned Tutor", async () => {
    server.children = [structuredClone(TOM)];
    await renderApp("/staff/u-ana?tab=children");
    await expect
      .element(details().getByText("Not an Assigned Tutor of any Child yet."))
      .toBeVisible();
    await expect
      .element(details().getByRole("heading", { name: "Assigned Children · 0" }))
      .toBeVisible();
  });

  it("shows a skeleton and the known count while loading", async () => {
    server.read = never;
    await renderApp("/staff/u-ana?tab=children");
    await expect
      .element(page.getByRole("status", { name: "Loading assigned Children" }))
      .toBeVisible();
    await expect
      .element(details().getByRole("heading", { name: "Assigned Children · 2" }))
      .toBeVisible();
  });

  it("offers Try again when the list fails", async () => {
    server.read = () => Promise.reject(makeError(500));
    await renderApp("/staff/u-ana?tab=children");
    await expect
      .element(
        details().getByText(
          "Couldn’t load their Children. Check your connection and try again.",
        ),
      )
      .toBeVisible();
    server.read = undefined;
    await details().getByRole("button", { name: "Try again" }).click();
    await expect.element(card("Emma Garcia")).toBeVisible();
  });

  it("explains an archived Tutor's list and offers no Change", async () => {
    server.children = [];
    await renderApp("/staff/u-zoe?tab=children");
    await expect
      .element(
        details().getByText(
          "Archiving Zoe removed them as an Assigned Tutor. Restore doesn’t bring that back: after Restore, assign them again here.",
        ),
      )
      .toBeVisible();
    expect(details().getByRole("button", { name: "Change" }).elements()).toHaveLength(0);
  });

  it("searches the sheet by Child and by Guardian", async () => {
    await renderApp("/staff/u-ana?tab=children");
    await openSheet();
    // Live Children only.
    expect(sheet().getByRole("checkbox").elements()).toHaveLength(3);
    const search = sheet().getByRole("searchbox", { name: "Search Children" });
    await search.fill("tom");
    await expect.element(sheet().getByRole("checkbox", { name: /Tom Lee/ })).toBeVisible();
    expect(sheet().getByRole("checkbox").elements()).toHaveLength(1);
    await search.fill("martinez");
    await expect
      .element(sheet().getByRole("checkbox", { name: /Sofia Reyes/ }))
      .toBeVisible();
    expect(sheet().getByRole("checkbox").elements()).toHaveLength(1);
    await search.fill("nobody");
    await expect.element(sheet().getByText("No Children match.")).toBeVisible();
  });
});

describe("Staff › Children: who sees what", () => {
  it("lets a Manager change a Tutor's Children", async () => {
    await renderApp("/staff/u-ana?tab=children", "manager");
    await expect.element(details().getByRole("button", { name: "Change" })).toBeVisible();
  });

  it("has no Children tab for an Admin", async () => {
    await renderApp("/staff/u-rita?tab=children");
    await expect.element(details().getByText("Email")).toBeVisible();
    expect(details().getByRole("button", { name: "Children" }).elements()).toHaveLength(0);
  });
});

function getScrollParent(element: HTMLElement): HTMLElement {
  let parent = element.parentElement;
  while (parent && getComputedStyle(parent).overflowY !== "auto") {
    parent = parent.parentElement;
  }
  if (!parent) throw new Error("No scrolling ancestor");
  return parent;
}

const MANY_CHILDREN = 20;

describe("Staff › Children: the Change sheet", () => {
  it("keeps the pinned search flush with the top while the list scrolls", async () => {
    await page.viewport(PHONE.width, PHONE.height);
    server.children = [
      ...server.children,
      ...Array.from({ length: MANY_CHILDREN }, (_, index) =>
        makeChild({
          id: `c-extra-${index}`,
          name: `Extra Child ${String(index).padStart(2, "0")}`,
          guardians: [{ id: `g-extra-${index}`, name: `Pat Extra${index}` }],
        }),
      ),
    ];
    await renderApp("/staff/u-ana?tab=children");
    await openSheet();
    const search = sheet()
      .getByRole("searchbox", { name: "Search Children" })
      .element() as HTMLElement;
    const pinned = search.closest<HTMLElement>(".sticky");
    if (!pinned) throw new Error("No pinned header");
    const scroller = getScrollParent(pinned);
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => pinned.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
      .toBeLessThan(1);
    // The list did scroll under it.
    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  it("marks the Children they'd be the only Tutor of, live", async () => {
    await renderApp("/staff/u-ana?tab=children");
    await openSheet();
    const tom = sheet().getByRole("checkbox", { name: /Tom Lee/ });
    await expect.element(sheet().getByText(/Garcia family · Covers Maths Grade 5 · Ana is their only Assigned Tutor/)).toBeVisible();
    await expect.element(tom).not.toBeChecked();
    await expect.element(sheet().getByText("Lee family · Covers Maths Grade 2")).toBeVisible();
  });

  it("saves only the changed Children, with a plain toast", async () => {
    await renderApp("/staff/u-ana?tab=children");
    await openSheet();
    await sheet().getByRole("checkbox", { name: /Tom Lee/ }).click();
    await sheet().getByRole("checkbox", { name: /Sofia Reyes/ }).click();
    await sheet().getByRole("button", { name: "Save" }).click();
    await expect
      .element(page.getByRole("status").filter({ hasText: "Ana’s Children saved." }))
      .toBeVisible();
    expect(getWriteUrls()).toEqual([
      "DELETE /api/children/c-sofia/assigned-tutors/u-ana",
      "POST /api/children/c-tom/assigned-tutors u-ana",
    ]);
    await expect.element(page.getByRole("dialog", { name: "Ana’s Children" })).not.toBeInTheDocument();
    expect(page.getByRole("button", { name: "Undo" }).elements()).toHaveLength(0);
    await expect.element(card("Tom Lee")).toBeVisible();
    await expect
      .element(details().getByRole("button", { name: /^Sofia Reyes/ }))
      .not.toBeInTheDocument();
  });

  it("closes with no request when nothing changed", async () => {
    await renderApp("/staff/u-ana?tab=children");
    await openSheet();
    await sheet().getByRole("button", { name: "Save" }).click();
    await expect.element(page.getByRole("dialog", { name: "Ana’s Children" })).not.toBeInTheDocument();
    expect(getWriteUrls()).toEqual([]);
  });

  it("leaves a Child with no Tutor at once, and Undo puts them back", async () => {
    await renderApp("/staff/u-ana?tab=children");
    await openSheet();
    await sheet().getByRole("checkbox", { name: /Emma Garcia/ }).click();
    await sheet().getByRole("button", { name: "Save" }).click();
    // No confirm first.
    const toast = page
      .getByRole("status")
      .filter({ hasText: "Saved. Emma now needs a Tutor and is in To do." });
    await expect.element(toast).toBeVisible();
    expect(page.getByRole("alertdialog").elements()).toHaveLength(0);
    expect(getTutorIds("c-emma")).toEqual([]);
    await expect.element(card("Emma Garcia")).not.toBeInTheDocument();

    await toast.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => getTutorIds("c-emma")).toEqual([ANA.id]);
    await expect.element(card("Emma Garcia")).toBeVisible();
  });

  it("keeps the sheet open when some changes fail, and re-seeds from the server", async () => {
    server.refuse = { childId: "c-tom", status: 409 };
    await renderApp("/staff/u-ana?tab=children");
    await openSheet();
    await sheet().getByRole("checkbox", { name: /Tom Lee/ }).click();
    await sheet().getByRole("checkbox", { name: /Sofia Reyes/ }).click();
    await sheet().getByRole("button", { name: "Save" }).click();
    await expect
      .element(
        sheet().getByText("Some changes didn’t save. Check the list and try again."),
      )
      .toBeVisible();
    // Sofia's removal went through; Tom's add didn't.
    expect(getTutorIds("c-sofia")).toEqual([MO.id]);
    await expect
      .element(sheet().getByRole("checkbox", { name: /Sofia Reyes/ }))
      .not.toBeChecked();
    await expect
      .element(sheet().getByRole("checkbox", { name: /Tom Lee/ }))
      .not.toBeChecked();
  });
});
