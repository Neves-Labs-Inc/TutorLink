import { useState } from "react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import KitRoot from "@/components/kit/kit-root";
import FamilyPage from "@/pages/families/family-page";
import { useFamilyDetails } from "@/pages/families/hooks/use-family-details";
import { renderWithProviders } from "@/test/render-with-providers";
import type { HouseholdRead } from "@/types/families";

const network = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: { get: network.get },
}));

// Stands in for ticket 08's stateful overlay: it remembers the Guardian
// it mounted for, so a reused instance shows up as a mismatch.
vi.mock("@/pages/families/components/guardian-details-overlay", () => ({
  default: function GuardianStub({
    guardianId,
    isOpen,
  }: {
    guardianId: string;
    isOpen: boolean;
  }): ReactNode {
    const [mountedFor] = useState(guardianId);
    return isOpen ? <p>{`Shows ${guardianId}, mounted for ${mountedFor}`}</p> : null;
  },
}));

const HOUSEHOLD: HouseholdRead = {
  key: "g-1",
  name: "Souza",
  archived: false,
  guardians: [
    { id: "g-1", name: "Laura Souza", phone_number: "+1", archived: false },
    { id: "g-3", name: "Diego Souza", phone_number: "+2", archived: false },
  ],
  children: [{ id: "c-1", name: "Sofia Souza", grade_level: 5, archived: false }],
  homes: [],
  next_booking: null,
};

function TestControls(): ReactNode {
  const navigate = useNavigate();
  const { openGuardian } = useFamilyDetails();
  return (
    <div>
      <button type="button" onClick={() => openGuardian("g-1")}>
        Test: open g-1
      </button>
      <button type="button" onClick={() => openGuardian("g-3")}>
        Test: open g-3
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Test: back
      </button>
    </div>
  );
}

beforeEach(async () => {
  await page.viewport(1280, 800);
  network.get.mockReset();
  network.get.mockImplementation((url: string) =>
    url === "/api/households/g-1"
      ? Promise.resolve({ data: HOUSEHOLD })
      : new Promise(() => {}),
  );
});

describe("details host", () => {
  it("gives a newly opened record its own overlay, not the popped one's", async () => {
    await renderWithProviders(
      <MemoryRouter initialEntries={["/families/g-1?child=c-1"]}>
        <Routes>
          <Route
            path="/families/:memberId"
            element={
              <>
                <KitRoot theme="light" height="640px">
                  <FamilyPage />
                </KitRoot>
                <TestControls />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    await expect.element(page.getByRole("dialog", { name: "Child details" })).toBeVisible();

    await page.getByRole("button", { name: "Test: open g-1" }).click();
    await expect.element(page.getByText("Shows g-1, mounted for g-1")).toBeVisible();
    await page.getByRole("button", { name: "Test: back" }).click();
    await expect.element(page.getByText(/Shows g-1/)).not.toBeInTheDocument();

    await page.getByRole("button", { name: "Test: open g-3" }).click();
    await expect.element(page.getByText("Shows g-3, mounted for g-3")).toBeVisible();
  });
});
