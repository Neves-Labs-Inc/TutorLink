import { describe, expect, it } from "vitest";
import { parsePreference, resolveTheme } from "@/lib/theme/theme";

describe("resolveTheme", () => {
  it.each([
    { preference: "light", isOsDark: false, expected: "light" },
    { preference: "light", isOsDark: true, expected: "light" },
    { preference: "dark", isOsDark: false, expected: "dark" },
    { preference: "dark", isOsDark: true, expected: "dark" },
    { preference: "system", isOsDark: false, expected: "light" },
    { preference: "system", isOsDark: true, expected: "dark" },
  ] as const)(
    "resolves $preference with OS dark=$isOsDark to $expected",
    ({ preference, isOsDark, expected }) => {
      expect(resolveTheme(preference, isOsDark)).toBe(expected);
    },
  );
});

describe("parsePreference", () => {
  it.each(["light", "dark", "system"] as const)(
    "keeps a stored %s choice",
    (stored) => {
      expect(parsePreference(stored)).toBe(stored);
    },
  );

  it("defaults to system when nothing is stored", () => {
    expect(parsePreference(null)).toBe("system");
  });

  it.each(["", "Dark", "blue", "null", '"dark"'])(
    "falls back to system for the unknown stored value %j",
    (stored) => {
      expect(parsePreference(stored)).toBe("system");
    },
  );
});
