import { describe, expect, it } from "vitest";
import { getChildTones } from "@/components/kit/lib/child-tones";

describe("getChildTones", () => {
  it("gives the first four Children a pastel and the fifth on neutral", () => {
    const tones = getChildTones(["a", "b", "c", "d", "e", "f"]);

    expect([...tones.values()]).toEqual([
      "primary",
      "green",
      "yellow",
      "pink",
      "neutral",
      "neutral",
    ]);
  });
});
