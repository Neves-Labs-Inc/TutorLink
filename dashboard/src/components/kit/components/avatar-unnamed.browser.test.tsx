import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import KitRoot from "@/components/kit/kit-root";
import { Avatar } from "@/components/kit/components/badges";

const SIZE_PX = { sm: 32, md: 40, lg: 48 } as const;

describe("Avatar with no name", () => {
  it.each(["sm", "md", "lg"] as const)(
    "renders the sunk disc with an icon at %s",
    async (size) => {
      const { container } = await render(
        <KitRoot theme="light">
          <Avatar name={null} size={size} />
        </KitRoot>,
      );
      const disc = container.querySelector("span[aria-hidden]") as HTMLElement;
      expect(disc.className).toContain("bg-(--tl-surface-sunk)");
      expect(disc.getBoundingClientRect().width).toBe(SIZE_PX[size]);
      expect(disc.querySelector("svg")).not.toBeNull();
    },
  );
});
