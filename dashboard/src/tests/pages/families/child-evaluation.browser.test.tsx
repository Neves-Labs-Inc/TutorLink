import { AxiosError, AxiosHeaders } from "axios";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import type { Theme } from "@/components/kit/tokens";
import FamilyPage from "@/pages/families/family-page";
import { renderWithProviders } from "@/test/render-with-providers";
import type {
  AssignedTutorRead,
  ChildDetail,
  ChildLevelRead,
  HouseholdRead,
  Page,
  StaffRead,
  SubjectRead,
} from "@/types/families";

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

const HOUSEHOLD: HouseholdRead = {
  key: "g-1",
  name: "Laura Souza",
  archived: false,
  guardians: [
    { id: "g-1", name: "Laura Souza", phone_number: "+13055550100", archived: false },
  ],
  children: [{ id: "c-1", name: "Sofia Souza", grade_level: 5, archived: false }],
  homes: [],
  next_booking: null,
};

const ADMIN = { id: "u-admin", name: "Maria Lopez" };

function makeLevel(
  subjectId: string,
  name: string,
  level: number,
  overrides: Partial<ChildLevelRead> = {},
): ChildLevelRead {
  return {
    subject_id: subjectId,
    name,
    archived: false,
    level,
    set_by: { id: "t-ana", name: "Ana Brooks" },
    updated_at: "2026-08-28T15:00:00-04:00",
    ...overrides,
  };
}

const ANA_TUTOR: AssignedTutorRead = { id: "t-ana", name: "Ana Brooks", role: "tutor" };
const MARCO_TUTOR: AssignedTutorRead = {
  id: "t-marco",
  name: "Marco Diaz",
  role: "manager",
};

const SOFIA: ChildDetail = {
  id: "c-1",
  name: "Sofia Souza",
  date_of_birth: "2016-03-04",
  grade_level: 5,
  school_name: "Lincoln Elementary",
  notes: null,
  archived: false,
  upcoming_session_count: 0,
  next_session: null,
  guardians: [
    {
      id: "g-1",
      name: "Laura Souza",
      phone_number: "+13055550100",
      archived: false,
      language: "en",
      reminders: "opt_in",
      reminders_blocked_by_whatsapp: false,
    },
  ],
  homes: [],
  levels: [],
  evaluated: null,
  assigned_tutors: [],
  evaluation_run_by: null,
};

function makeSubject(id: string, name: string): SubjectRead {
  return { id, name, name_es: null, description: null, archived: false, tutor_count: 1 };
}

const SUBJECTS: Page<SubjectRead> = {
  items: [makeSubject("s-math", "Math"), makeSubject("s-read", "Reading")],
  total: 2,
  page: 1,
  page_size: 100,
};

function makeStaff(
  id: string,
  name: string,
  role: StaffRead["role"],
  subjects: StaffRead["subjects"],
): StaffRead {
  return {
    id,
    name,
    role,
    tutor_id: null,
    email: `${id}@example.com`,
    sign_in_state: "active",
    invite_expires_at: null,
    archived: false,
    subjects,
    sessions_this_week: 0,
    assigned_children: [],
    phone_number: null,
    bio: null,
    has_pending_time_off: false,
  };
}

const STAFF: Page<StaffRead> = {
  items: [
    makeStaff("t-marco", "Marco Diaz", "manager", [
      { id: "s-math", name: "Math", max_grade_level: 8 },
    ]),
    makeStaff("u-admin", "Maria Lopez", "admin", []),
    makeStaff("t-ana", "Ana Brooks", "tutor", [
      { id: "s-math", name: "Math", max_grade_level: 6 },
      { id: "s-read", name: "Reading", max_grade_level: 6 },
    ]),
  ],
  total: 3,
  page: 1,
  page_size: 100,
};

const SUBJECT_NAMES: Record<string, string> = { "s-math": "Math", "s-read": "Reading" };
const STAFF_ROLES: Record<string, AssignedTutorRead> = {
  "t-ana": ANA_TUTOR,
  "t-marco": MARCO_TUTOR,
};

function httpError(status: number, detail = String(status)): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError(String(status), "ERR_BAD_REQUEST", config, null, {
    status,
    statusText: String(status),
    headers: {},
    config,
    data: { detail },
  });
}

const NOT_ASSIGNABLE = "Only an active Tutor or Manager can be an Assigned Tutor";
const NO_LEVELS =
  "Add at least one subject level before marking the child Evaluated";

type Handler = (url: string, body?: unknown) => Promise<unknown> | undefined;

let child: ChildDetail = SOFIA;
let staff: Page<StaffRead> = STAFF;
// A test's override for one write; return undefined to fall through.
let failWrite: Handler = () => undefined;
let subjectsResponse: () => Promise<unknown> = () => Promise.resolve({ data: SUBJECTS });

const CHILD_URL = "/api/children/c-1";
const LEVEL_URL = /^\/api\/children\/c-1\/levels\/(.+)$/;
const TUTOR_URL = /^\/api\/children\/c-1\/assigned-tutors\/(.+)$/;
const EVALUATED_AT = "2026-10-21T12:00:00-04:00";

// A small in-memory API: writes change `child`, so refetches show them.
function handleGet(url: string): Promise<unknown> {
  const routes: Record<string, () => Promise<unknown>> = {
    "/api/households/g-1": () => Promise.resolve({ data: HOUSEHOLD }),
    [CHILD_URL]: () => Promise.resolve({ data: child }),
    "/api/subjects": subjectsResponse,
    "/api/staff": () => Promise.resolve({ data: staff }),
    "/api/clients/g-1": () => Promise.reject(httpError(404)),
  };
  const respond = routes[url];
  return respond ? respond() : Promise.reject(httpError(404));
}

function handlePut(url: string, body: unknown): Promise<unknown> {
  const failed = failWrite(`PUT ${url}`, body);
  if (failed) return failed;
  const subjectId = LEVEL_URL.exec(url)?.[1] ?? "";
  const { level } = body as { level: number };
  const row = makeLevel(subjectId, SUBJECT_NAMES[subjectId], level, {
    set_by: ADMIN,
  });
  child = {
    ...child,
    levels: [...child.levels.filter((item) => item.subject_id !== subjectId), row],
  };
  return Promise.resolve({ data: row });
}

function handleDelete(url: string): Promise<unknown> {
  const failed = failWrite(`DELETE ${url}`);
  if (failed) return failed;
  const levelId = LEVEL_URL.exec(url)?.[1];
  const tutorId = TUTOR_URL.exec(url)?.[1];
  if (levelId) {
    child = { ...child, levels: child.levels.filter((item) => item.subject_id !== levelId) };
  } else if (tutorId) {
    child = {
      ...child,
      assigned_tutors: child.assigned_tutors.filter((tutor) => tutor.id !== tutorId),
    };
  } else {
    child = { ...child, evaluated: null };
  }
  return Promise.resolve({ data: null });
}

function handlePost(url: string, body: unknown): Promise<unknown> {
  const failed = failWrite(`POST ${url}`, body);
  if (failed) return failed;
  if (url === `${CHILD_URL}/evaluated`) {
    const { tutor_ids: tutorIds } = body as { tutor_ids: string[] };
    const evaluated = { at: EVALUATED_AT, by: ADMIN };
    child = {
      ...child,
      evaluated,
      assigned_tutors: tutorIds.map((id) => STAFF_ROLES[id]),
    };
    return Promise.resolve({ data: evaluated });
  }
  const { user_id: userId } = body as { user_id: string };
  child = { ...child, assigned_tutors: [...child.assigned_tutors, STAFF_ROLES[userId]] };
  return Promise.resolve({ data: child.assigned_tutors });
}

// Every write, in order, as "METHOD url".
function writes(): string[] {
  const calls = [
    ...network.put.mock.calls.map((call, index) => ({
      line: `PUT ${call[0]} ${JSON.stringify(call[1])}`,
      order: network.put.mock.invocationCallOrder[index],
    })),
    ...network.delete.mock.calls.map((call, index) => ({
      line: `DELETE ${call[0]}`,
      order: network.delete.mock.invocationCallOrder[index],
    })),
    ...network.post.mock.calls.map((call, index) => ({
      line: `POST ${call[0]} ${JSON.stringify(call[1])}`,
      order: network.post.mock.invocationCallOrder[index],
    })),
  ];
  return calls.sort((a, b) => a.order - b.order).map((call) => call.line);
}

function renderAt(theme: Theme = "light") {
  window.history.pushState(null, "", "/families/g-1?child=c-1");
  return renderWithProviders(
    <BrowserRouter>
      <Routes>
        <Route
          path="/families/:memberId"
          element={
            <KitRoot theme={theme} height="740px">
              <FamilyPage />
            </KitRoot>
          }
        />
      </Routes>
    </BrowserRouter>,
  );
}

const overlay = () => page.getByRole("dialog", { name: "Sofia Souza" });
const sheet = (name: string) => page.getByRole("dialog", { name });

async function choose(field: string, option: string, within = sheet("Mark Evaluated")) {
  await within.getByRole("combobox", { name: field, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

const startUrl = window.location.href;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00-04:00"));
  await page.viewport(1280, 800);
  child = SOFIA;
  staff = STAFF;
  failWrite = () => undefined;
  subjectsResponse = () => Promise.resolve({ data: SUBJECTS });
  for (const mock of Object.values(network)) mock.mockReset();
  network.get.mockImplementation(handleGet);
  network.put.mockImplementation(handlePut);
  network.delete.mockImplementation(handleDelete);
  network.post.mockImplementation(handlePost);
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, "", startUrl);
});

describe("subject levels card", () => {
  it.each(["light", "dark"] as const)(
    "lists the levels and the Evaluated line (%s)",
    async (theme) => {
      child = {
        ...SOFIA,
        levels: [
          makeLevel("s-math", "Math", 5),
          makeLevel("s-sci", "Science", 4, { archived: true }),
        ],
        evaluated: { at: "2026-08-28T15:00:00-04:00", by: ADMIN },
        assigned_tutors: [ANA_TUTOR],
      };
      await renderAt(theme);
      const details = overlay();
      await expect
        .element(details.getByRole("heading", { name: "Subject levels" }))
        .toBeVisible();
      await expect.element(details.getByText("Math", { exact: true })).toBeVisible();
      await expect.element(details.getByText("Science (archived Subject)")).toBeVisible();
      await expect.element(details.getByText("Grade 4")).toBeVisible();
      await expect
        .element(details.getByText("Evaluated Aug 28, 2026 by Maria Lopez"))
        .toBeVisible();
      await expect
        .element(details.getByRole("button", { name: "Mark Evaluated" }))
        .not.toBeInTheDocument();
    },
  );

  it("prompts to Mark Evaluated when not Evaluated", async () => {
    await renderAt();
    const details = overlay();
    await expect.element(details.getByText("No Subject levels yet")).toBeVisible();
    await expect
      .element(details.getByText("The bot can’t book them until they’re Evaluated."))
      .toBeVisible();
    await expect
      .element(details.getByRole("button", { name: "Mark Evaluated" }))
      .toBeVisible();
  });

  it("shows no edit controls on an archived Child", async () => {
    child = { ...SOFIA, archived: true, assigned_tutors: [ANA_TUTOR] };
    await renderAt();
    const details = overlay();
    await expect.element(details.getByText("No Subject levels yet")).toBeVisible();
    for (const name of ["Set level", "Mark Evaluated", "Change", "Assign Tutors"]) {
      expect(details.getByRole("button", { name }).elements()).toHaveLength(0);
    }
  });
});

describe("set level", () => {
  it("prefills the current level, saves it and toasts", async () => {
    child = { ...SOFIA, levels: [makeLevel("s-math", "Math", 4)] };
    await renderAt();
    await overlay().getByRole("button", { name: "Set level" }).click();
    const form = sheet("Set Subject level");
    await expect.element(form.getByText("Now Grade 4, set by Ana Brooks.")).toBeVisible();
    await expect
      .element(form.getByRole("combobox", { name: "Subject level" }))
      .toHaveTextContent("Grade 4");

    await choose("Subject level", "Grade 6", form);
    await form.getByRole("button", { name: "Save level" }).click();

    await expect.element(page.getByText("Subject level saved.")).toBeVisible();
    expect(writes()).toEqual(['PUT /api/children/c-1/levels/s-math {"level":6}']);
    await expect.element(sheet("Set Subject level")).not.toBeInTheDocument();
    await expect.element(overlay().getByText("Grade 6")).toBeVisible();
  });

  it("focuses the Subject", async () => {
    await renderAt();
    await overlay().getByRole("button", { name: "Set level" }).click();
    await expect
      .element(sheet("Set Subject level").getByRole("combobox", { name: "Subject", exact: true }))
      .toHaveFocus();
  });

  it("starts a new Subject at the Overall grade", async () => {
    await renderAt();
    await overlay().getByRole("button", { name: "Set level" }).click();
    const form = sheet("Set Subject level");
    await choose("Subject", "Reading", form);
    await expect
      .element(form.getByRole("combobox", { name: "Subject level" }))
      .toHaveTextContent("Grade 5");
  });

  it("keeps the sheet open with a failure line when the save fails", async () => {
    failWrite = (line) => (line.startsWith("PUT") ? Promise.reject(httpError(500)) : undefined);
    await renderAt();
    await overlay().getByRole("button", { name: "Set level" }).click();
    await sheet("Set Subject level").getByRole("button", { name: "Save level" }).click();
    await expect
      .element(
        sheet("Set Subject level").getByText(
          "Couldn’t save the level. Check your connection and try again.",
        ),
      )
      .toBeVisible();
  });
});

describe("mark evaluated", () => {
  const RUN_BY_ANA: ChildDetail = {
    ...SOFIA,
    levels: [makeLevel("s-math", "Math", 4), makeLevel("s-read", "Reading", 3)],
    evaluation_run_by: ANA_TUTOR,
  };

  async function openMarkEvaluated(): Promise<void> {
    await renderAt();
    await overlay().getByRole("button", { name: "Mark Evaluated" }).click();
    await expect.element(sheet("Mark Evaluated")).toBeVisible();
  }

  it("pre-ticks the runner and prefills the levels", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    const form = sheet("Mark Evaluated");
    await expect
      .element(
        form.getByText("Ana Brooks ran the Evaluation session, so they’re picked to start."),
      )
      .toBeVisible();
    await expect.element(form.getByRole("checkbox", { name: /^Ana Brooks/ })).toBeChecked();
    await expect
      .element(form.getByRole("checkbox", { name: /^Marco Diaz · Manager/ }))
      .not.toBeChecked();
    await expect.element(form.getByRole("combobox", { name: "Math" })).toHaveTextContent("Grade 4");
    await expect
      .element(
        form.getByText(
          "The grade Sofia works at in each Subject (overall: Grade 5). Leave the rest Not set.",
        ),
      )
      .toBeVisible();
  });

  it("focuses the first Subject level", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    await expect
      .element(sheet("Mark Evaluated").getByRole("combobox", { name: "Math" }))
      .toHaveFocus();
  });

  it("says when there's no Evaluation session on record", async () => {
    await openMarkEvaluated();
    await expect
      .element(
        sheet("Mark Evaluated").getByText(
          "No Evaluation session on record. Pick who’ll teach them.",
        ),
      )
      .toBeVisible();
    expect(sheet("Mark Evaluated").getByRole("checkbox", { checked: true }).elements()).toHaveLength(0);
  });

  it("lists only Tutors and Managers, with coverage of the chosen levels", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    const form = sheet("Mark Evaluated");
    await expect.element(form.getByRole("checkbox", { name: /^Ana Brooks/ })).toBeVisible();
    expect(form.getByRole("checkbox").elements()).toHaveLength(2);
    expect(form.getByText("Maria Lopez").elements()).toHaveLength(0);
    await expect
      .element(form.getByText("Covers Math Grade 4, Reading Grade 3"))
      .toBeVisible();
    await expect.element(form.getByText("Covers Math · not Reading")).toBeVisible();

    // Coverage follows the levels picked in the sheet.
    await choose("Reading", "Grade 8");
    await expect
      .poll(() => form.getByText("Covers Math · not Reading").elements().length)
      .toBe(2);
    await expect
      .element(
        form.getByText(
          "None of them covers Reading Grade 8. When a Guardian asks for it, the bot hands the request to the office.",
        ),
      )
      .toBeVisible();
    await expect
      .element(
        form.getByText("Admins can’t be Assigned Tutors. The bot only offers Tutors picked here."),
      )
      .toBeVisible();
  });

  it("asks for a level and a Tutor on submit", async () => {
    await openMarkEvaluated();
    const form = sheet("Mark Evaluated");
    await form.getByRole("button", { name: "Mark Evaluated" }).click();
    await expect.element(form.getByText("Set at least one Subject level.")).toBeVisible();
    await expect.element(form.getByText("Pick at least one Tutor.")).toBeVisible();
    expect(writes()).toEqual([]);
  });

  it("saves levels, removals, then Evaluated, and toasts", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    const form = sheet("Mark Evaluated");
    await choose("Math", "Grade 5");
    await choose("Reading", "Not set");
    await form.getByRole("checkbox", { name: /^Marco Diaz/ }).click();
    await form.getByRole("button", { name: "Mark Evaluated" }).click();

    await expect
      .element(
        page.getByText(
          "Sofia Souza marked Evaluated. The bot can book them with Ana or Marco now.",
        ),
      )
      .toBeVisible();
    expect(writes()).toEqual([
      'PUT /api/children/c-1/levels/s-math {"level":5}',
      "DELETE /api/children/c-1/levels/s-read",
      'POST /api/children/c-1/evaluated {"tutor_ids":["t-ana","t-marco"]}',
    ]);
    await expect.element(sheet("Mark Evaluated")).not.toBeInTheDocument();
    await expect
      .element(overlay().getByText("Evaluated Oct 21, 2026 by Maria Lopez"))
      .toBeVisible();
    await expect
      .element(overlay().getByRole("heading", { name: "Assigned Tutors · 2" }))
      .toBeVisible();
  });

  it("Undo clears Evaluated, puts the earlier levels back and keeps the Tutors", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    await choose("Math", "Grade 5");
    await choose("Reading", "Not set");
    await sheet("Mark Evaluated").getByRole("button", { name: "Mark Evaluated" }).click();
    await page.getByRole("button", { name: "Undo" }).click();

    await expect
      .element(overlay().getByRole("button", { name: "Mark Evaluated" }))
      .toBeVisible();
    expect(writes().slice(3)).toEqual([
      "DELETE /api/children/c-1/evaluated",
      'PUT /api/children/c-1/levels/s-math {"level":4}',
      'PUT /api/children/c-1/levels/s-read {"level":3}',
    ]);
    expect(network.delete).not.toHaveBeenCalledWith(
      expect.stringContaining("/assigned-tutors/"),
    );
    await expect
      .element(
        overlay().getByText(
          "Kept from before. Mark Evaluated sets them again, and they can’t be changed until then.",
        ),
      )
      .toBeVisible();
  });

  it("Undo deletes a level the save added", async () => {
    child = { ...RUN_BY_ANA, levels: [] };
    await openMarkEvaluated();
    await choose("Math", "Grade 5");
    await sheet("Mark Evaluated").getByRole("button", { name: "Mark Evaluated" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.element(overlay().getByText("No Subject levels yet")).toBeVisible();
    expect(writes().slice(2)).toEqual([
      "DELETE /api/children/c-1/evaluated",
      "DELETE /api/children/c-1/levels/s-math",
    ]);
  });

  it("toasts an error when Undo fails", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    await sheet("Mark Evaluated").getByRole("button", { name: "Mark Evaluated" }).click();
    failWrite = (line) =>
      line === "DELETE /api/children/c-1/evaluated" ? Promise.reject(httpError(500)) : undefined;
    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .element(page.getByText("Couldn’t undo. Sofia is still Evaluated."))
      .toBeVisible();
  });

  it("names a Tutor who can't be assigned any more", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    failWrite = (line) => {
      if (!line.startsWith("POST")) return undefined;
      // Ana was archived meanwhile.
      staff = { ...STAFF, items: STAFF.items.filter((person) => person.id !== "t-ana") };
      return Promise.reject(httpError(422, NOT_ASSIGNABLE));
    };
    await sheet("Mark Evaluated").getByRole("button", { name: "Mark Evaluated" }).click();
    await expect
      .element(
        sheet("Mark Evaluated").getByRole("alert").filter({
          hasText: "Ana Brooks can’t be assigned any more. Pick someone else.",
        }),
      )
      .toBeVisible();
    expect(sheet("Mark Evaluated").getByText("Pick at least one Tutor.").elements()).toHaveLength(0);
    // The Child reloads.
    expect(
      network.get.mock.calls.filter(([url]) => url === CHILD_URL).length,
    ).toBeGreaterThan(1);
  });

  it("Undo after a failed save and a retry restores the levels as the sheet opened", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    await choose("Math", "Grade 5");
    await choose("Reading", "Not set");
    let isFirstDelete = true;
    failWrite = (line) => {
      if (line !== "DELETE /api/children/c-1/levels/s-read" || !isFirstDelete) return undefined;
      isFirstDelete = false;
      return Promise.reject(httpError(500));
    };
    const form = sheet("Mark Evaluated");
    await form.getByRole("button", { name: "Mark Evaluated" }).click();
    await expect
      .element(form.getByText("Couldn’t mark Sofia Evaluated. Check your connection and try again."))
      .toBeVisible();
    await form.getByRole("button", { name: "Mark Evaluated" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.element(overlay().getByRole("button", { name: "Mark Evaluated" })).toBeVisible();
    expect(writes()).toEqual([
      'PUT /api/children/c-1/levels/s-math {"level":5}',
      "DELETE /api/children/c-1/levels/s-read",
      // The retry, from the reloaded Child: Math is saved already.
      "DELETE /api/children/c-1/levels/s-read",
      'POST /api/children/c-1/evaluated {"tutor_ids":["t-ana"]}',
      "DELETE /api/children/c-1/evaluated",
      'PUT /api/children/c-1/levels/s-math {"level":4}',
      'PUT /api/children/c-1/levels/s-read {"level":3}',
    ]);
  });

  it("says when Undo cleared Evaluated but couldn't restore a level", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    await choose("Math", "Grade 5");
    await sheet("Mark Evaluated").getByRole("button", { name: "Mark Evaluated" }).click();
    failWrite = (line) =>
      line.startsWith("PUT") ? Promise.reject(httpError(409)) : undefined;
    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .element(
        page.getByText(
          "Sofia isn’t Evaluated any more, but some Subject levels weren’t put back. Check them.",
        ),
      )
      .toBeVisible();
  });

  it("shows the level error when the API finds no levels", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    failWrite = (line) =>
      line.startsWith("POST") ? Promise.reject(httpError(409, NO_LEVELS)) : undefined;
    await sheet("Mark Evaluated").getByRole("button", { name: "Mark Evaluated" }).click();
    await expect
      .element(sheet("Mark Evaluated").getByText("Set at least one Subject level."))
      .toBeVisible();
  });

  it("words other failures and keeps the sheet open", async () => {
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    failWrite = (line) => (line.startsWith("POST") ? Promise.reject(httpError(500)) : undefined);
    await sheet("Mark Evaluated").getByRole("button", { name: "Mark Evaluated" }).click();
    await expect
      .element(
        sheet("Mark Evaluated").getByText(
          "Couldn’t mark Sofia Evaluated. Check your connection and try again.",
        ),
      )
      .toBeVisible();
  });

  it("blocks Cancel and Escape while saving", async () => {
    child = RUN_BY_ANA;
    let release: (value: unknown) => void = () => {};
    await openMarkEvaluated();
    failWrite = (line, body) =>
      line.startsWith("POST")
        ? new Promise((resolve) => {
            release = resolve;
          }).then(() => handlePost(line.slice("POST ".length), body))
        : undefined;
    const form = sheet("Mark Evaluated");
    await form.getByRole("button", { name: "Mark Evaluated" }).click();
    await expect.element(form.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(sheet("Mark Evaluated")).toBeVisible();
    failWrite = () => undefined;
    release(null);
    await expect.element(sheet("Mark Evaluated")).not.toBeInTheDocument();
  });

  it("scrolls with the footer pinned on a phone", async () => {
    await page.viewport(375, 740);
    child = RUN_BY_ANA;
    await openMarkEvaluated();
    await expect
      .element(sheet("Mark Evaluated").getByRole("button", { name: "Cancel" }))
      .toBeInViewport();
  });
});

describe("assigned tutors section", () => {
  const EVALUATED: ChildDetail = {
    ...SOFIA,
    levels: [makeLevel("s-math", "Math", 5), makeLevel("s-read", "Reading", 4)],
    evaluated: { at: "2026-08-28T15:00:00-04:00", by: ADMIN },
    assigned_tutors: [ANA_TUTOR, MARCO_TUTOR],
  };

  it("says they're set by Mark Evaluated before then", async () => {
    await renderAt();
    await expect
      .element(
        overlay().getByText(
          "Set when you Mark Evaluated, after the Evaluation session. They can’t be changed until then.",
        ),
      )
      .toBeVisible();
    expect(overlay().getByRole("button", { name: "Change" }).elements()).toHaveLength(0);
  });

  it.each(["light", "dark"] as const)(
    "lists the Tutors with coverage and Change (%s)",
    async (theme) => {
      child = EVALUATED;
      await renderAt(theme);
      const details = overlay();
      await expect
        .element(details.getByRole("heading", { name: "Assigned Tutors · 2" }))
        .toBeVisible();
      await expect
        .element(details.getByText("Covers Math Grade 5, Reading Grade 4"))
        .toBeVisible();
      await expect.element(details.getByText("Covers Math · not Reading")).toBeVisible();
      await expect.element(details.getByText("Manager", { exact: true })).toBeVisible();
      await expect.element(details.getByRole("button", { name: "Change" })).toBeVisible();
    },
  );

  it("shows Needs a Tutor when Evaluated with none", async () => {
    child = { ...EVALUATED, assigned_tutors: [] };
    await renderAt();
    const callout = overlay().getByRole("region", { name: "Needs a Tutor" });
    await expect
      .element(
        callout.getByText(
          "Sofia has no Assigned Tutors. The bot hands every booking request to the office until you assign one. They’re in To do.",
        ),
      )
      .toBeVisible();
    await callout.getByRole("button", { name: "Assign Tutors" }).click();
    await expect.element(sheet("Assigned Tutors")).toBeVisible();
  });

  it("saves a change and toasts", async () => {
    child = EVALUATED;
    await renderAt();
    await overlay().getByRole("button", { name: "Change" }).click();
    const form = sheet("Assigned Tutors");
    await expect.element(form.getByRole("checkbox", { name: /^Ana Brooks/ })).toBeChecked();
    await form.getByRole("checkbox", { name: /^Marco Diaz/ }).click();
    await form.getByRole("button", { name: "Save Tutors" }).click();
    await expect.element(page.getByText("Assigned Tutors saved.")).toBeVisible();
    expect(writes()).toEqual(["DELETE /api/children/c-1/assigned-tutors/t-marco"]);
    await expect
      .element(overlay().getByRole("heading", { name: "Assigned Tutors · 1" }))
      .toBeVisible();
  });

  it("saves none without a confirm, and Undo re-adds them", async () => {
    child = EVALUATED;
    await renderAt();
    await overlay().getByRole("button", { name: "Change" }).click();
    const form = sheet("Assigned Tutors");
    await form.getByRole("checkbox", { name: /^Ana Brooks/ }).click();
    await form.getByRole("checkbox", { name: /^Marco Diaz/ }).click();
    await form.getByRole("button", { name: "Save Tutors" }).click();

    await expect
      .element(
        page.getByText(
          "Sofia has no Assigned Tutors now, so they’re in To do until you assign one.",
        ),
      )
      .toBeVisible();
    await expect.element(overlay().getByRole("region", { name: "Needs a Tutor" })).toBeVisible();
    // The family card's badge says it too, beside the callout.
    await expect
      .poll(() => page.getByText("Needs a Tutor", { exact: true }).elements().length)
      .toBe(2);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .element(overlay().getByRole("heading", { name: "Assigned Tutors · 2" }))
      .toBeVisible();
    expect(writes()).toEqual([
      "DELETE /api/children/c-1/assigned-tutors/t-ana",
      "DELETE /api/children/c-1/assigned-tutors/t-marco",
      'POST /api/children/c-1/assigned-tutors {"user_id":"t-ana"}',
      'POST /api/children/c-1/assigned-tutors {"user_id":"t-marco"}',
    ]);
  });

  it("says No Assigned Tutors on an archived Evaluated Child with none", async () => {
    child = { ...EVALUATED, archived: true, assigned_tutors: [] };
    await renderAt();
    await expect.element(overlay().getByText("No Assigned Tutors")).toBeVisible();
    const section = overlay().getByRole("region", { name: "Assigned Tutors", exact: true });
    await expect.element(section.getByText("No Assigned Tutors")).toBeVisible();
    expect(section.getByRole("list").elements()).toHaveLength(0);
  });

  it("drops a pick who can't be assigned any more, so a retry goes through", async () => {
    child = { ...EVALUATED, assigned_tutors: [ANA_TUTOR] };
    await renderAt();
    await overlay().getByRole("button", { name: "Change" }).click();
    failWrite = (line) => {
      if (!line.startsWith("POST")) return undefined;
      // Marco was archived meanwhile.
      staff = { ...STAFF, items: STAFF.items.filter((person) => person.id !== "t-marco") };
      return Promise.reject(httpError(422, NOT_ASSIGNABLE));
    };
    const form = sheet("Assigned Tutors");
    await form.getByRole("checkbox", { name: /^Marco Diaz/ }).click();
    await form.getByRole("button", { name: "Save Tutors" }).click();
    await expect
      .element(form.getByText("Couldn’t save Assigned Tutors. Check your connection and try again."))
      .toBeVisible();
    await expect.element(form.getByRole("checkbox", { name: /^Marco Diaz/ })).not.toBeInTheDocument();

    failWrite = () => undefined;
    await form.getByRole("button", { name: "Save Tutors" }).click();
    await expect.element(sheet("Assigned Tutors")).not.toBeInTheDocument();
    expect(writes()).toEqual(['POST /api/children/c-1/assigned-tutors {"user_id":"t-marco"}']);
  });

  it("keeps the sheet open after a partial failure, listing what saved", async () => {
    child = { ...EVALUATED, assigned_tutors: [ANA_TUTOR] };
    await renderAt();
    await overlay().getByRole("button", { name: "Change" }).click();
    failWrite = (line) =>
      line.startsWith("DELETE") ? Promise.reject(httpError(500)) : undefined;
    const form = sheet("Assigned Tutors");
    await form.getByRole("checkbox", { name: /^Ana Brooks/ }).click();
    await form.getByRole("checkbox", { name: /^Marco Diaz/ }).click();
    await form.getByRole("button", { name: "Save Tutors" }).click();
    await expect
      .element(
        form.getByText("Saved some changes, but not all. Check the list and try again."),
      )
      .toBeVisible();
    // Marco's add went through; Ana's removal didn't.
    await form.getByRole("button", { name: "Cancel" }).click();
    await expect
      .element(overlay().getByRole("heading", { name: "Assigned Tutors · 2" }))
      .toBeVisible();
  });
});
