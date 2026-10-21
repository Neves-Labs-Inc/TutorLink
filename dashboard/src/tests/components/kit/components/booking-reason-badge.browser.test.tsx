import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { BookingReasonBadge } from "@/components/kit/components/badges";
import type { BookingReasonKey } from "@/components/kit/lib/booking-reason";

const WARNING_REASONS: [BookingReasonKey, string][] = [
  ["not_completed", "Not marked"],
  ["time_off_clash", "Staff is off"],
  ["archived_staff", "Staff archived"],
  ["needs_tutor", "Needs a Tutor"],
];

describe("BookingReasonBadge", () => {
  it.each(WARNING_REASONS)("renders %s as a warning badge", async (reason, label) => {
    await render(
      <KitRoot theme="light">
        <BookingReasonBadge reason={reason} />
      </KitRoot>,
    );

    const badge = page.getByText(label).element();
    expect(badge.className).toContain("bg-(--tl-warning-tint)");
  });

  it("renders Evaluation to book as a pink badge", async () => {
    await render(
      <KitRoot theme="light">
        <BookingReasonBadge reason="evaluation_to_book" />
      </KitRoot>,
    );

    const badge = page.getByText("Evaluation to book").element();
    expect(badge.className).toContain("bg-(--tl-pink-tint)");
  });
});
