import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import {
  AttentionBadge,
  BookingStatusBadge,
  TimeOffBadge,
} from "@/components/kit/components/badges";
import { Button, IconButton } from "@/components/kit/components/button";
import { DataTable } from "@/components/kit/components/data-table";
import { ListRow } from "@/components/kit/components/list-row";
import type { Theme } from "@/components/kit/tokens";

const THEMES: Theme[] = ["light", "dark"];

type NewBadgeCase = {
  name: string;
  text: string;
  toneClass: string;
  element: ReactNode;
};

const NEW_BADGES: NewBadgeCase[] = [
  {
    name: "Didn't happen",
    text: "Didn’t happen",
    toneClass: "bg-(--tl-neutral-tint)",
    element: <BookingStatusBadge status="Didn't happen" />,
  },
  {
    name: "Didn't happen (wire value)",
    text: "Didn’t happen",
    toneClass: "bg-(--tl-neutral-tint)",
    element: <BookingStatusBadge status="didnt_happen" />,
  },
  {
    name: "Expired",
    text: "Expired",
    toneClass: "bg-(--tl-neutral-tint)",
    element: <TimeOffBadge status="Expired" />,
  },
  {
    name: "Reply window closed",
    text: "Reply window closed",
    toneClass: "bg-(--tl-warning-tint)",
    element: <AttentionBadge reason="Reply window closed" />,
  },
];

describe("new kit badges", () => {
  for (const theme of THEMES) {
    for (const { name, text, toneClass, element } of NEW_BADGES) {
      it(`shows ${name} with its icon, no dot and its tone in ${theme}`, async () => {
        await render(<KitRoot theme={theme}>{element}</KitRoot>);

        const badge = page.getByText(text).element();
        expect(badge.className).toContain(toneClass);
        expect(badge.querySelector("svg[aria-hidden='true']")).not.toBeNull();
        expect(badge.querySelector("span[aria-hidden]")).toBeNull();
      });
    }
  }

  it("keeps the alert icon on the other attention reasons", async () => {
    await render(
      <KitRoot theme="light">
        <AttentionBadge reason="Wants to book" />
      </KitRoot>,
    );

    const badge = page.getByText("Wants to book").element();
    expect(badge.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-circle-alert",
    );
  });

  it("shows a clock, not the alert icon, on Reply window closed", async () => {
    await render(
      <KitRoot theme="light">
        <AttentionBadge reason="Reply window closed" />
      </KitRoot>,
    );

    const badge = page.getByText("Reply window closed").element();
    expect(badge.querySelector("svg")?.getAttribute("class")).toContain(
      "lucide-clock",
    );
  });
});

describe("pressed state", () => {
  it("darkens every Button variant on press", async () => {
    await render(
      <KitRoot theme="light">
        <Button variant="primary">Primary</Button>
        <Button variant="soft">Soft</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="danger-outline">DangerOutline</Button>
      </KitRoot>,
    );

    const expected: Record<string, string[]> = {
      Primary: ["enabled:active:bg-(--tl-primary-hover)"],
      Soft: ["enabled:active:bg-(--tl-tint-strong)"],
      Outline: ["enabled:active:bg-(--tl-tint-strong)"],
      Ghost: ["enabled:active:bg-(--tl-tint-strong)"],
      Danger: ["enabled:active:bg-(--tl-danger-hover)"],
      DangerOutline: [
        "enabled:active:bg-(--tl-danger-tint)",
        "enabled:active:border-(--tl-danger)",
      ],
    };
    for (const [label, classes] of Object.entries(expected)) {
      const button = page
        .getByRole("button", { name: label, exact: true })
        .element();
      for (const cls of classes) {
        expect(button.className).toContain(cls);
      }
      expect(button.className).toContain("duration-150");
    }
  });

  it("darkens every IconButton variant on press", async () => {
    await render(
      <KitRoot theme="light">
        <IconButton icon={Plus} label="Plain" variant="plain" />
        <IconButton icon={Plus} label="Outlined" variant="outline" />
        <IconButton icon={Plus} label="Filled" variant="primary" />
      </KitRoot>,
    );

    const expected: Record<string, string> = {
      Plain: "enabled:active:bg-(--tl-tint-strong)",
      Outlined: "enabled:active:bg-(--tl-tint-strong)",
      Filled: "enabled:active:bg-(--tl-primary-hover)",
    };
    for (const [label, cls] of Object.entries(expected)) {
      const button = page
        .getByRole("button", { name: label, exact: true })
        .element();
      expect(button.className).toContain(cls);
    }
  });

  it("darkens a ListRow on press", async () => {
    await render(
      <KitRoot theme="light">
        <ListRow leading={null} title="Row title" onOpen={() => {}} />
      </KitRoot>,
    );

    const row = page.getByRole("button", { name: /Row title/ }).element();
    expect(row.className).toContain("active:bg-(--tl-tint)");
  });

  it("darkens table rows and phone rows on press", async () => {
    await render(
      <KitRoot theme="light">
        <DataTable
          caption="People"
          rows={[{ id: "1", name: "Ana" }]}
          columns={[{ id: "name", header: "Name", render: (row) => row.name }]}
          getRowId={(row) => row.id}
          getRowTitle={(row) => row.name}
          getPhoneRow={(row) => ({ title: row.name })}
          onOpenRow={() => {}}
        />
      </KitRoot>,
    );

    const tableRow = document.querySelector("tbody tr");
    const phoneRow = document.querySelector("ul[aria-label] li button");
    expect(tableRow?.className).toContain("active:bg-(--tl-tint-strong)");
    expect(phoneRow?.className).toContain("active:bg-(--tl-tint-strong)");
  });
});
