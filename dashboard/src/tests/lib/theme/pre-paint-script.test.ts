import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePreference, THEME_STORAGE_KEY } from "@/lib/theme/theme";

// The pre-paint script in index.html can't import theme.ts, so it repeats
// the key and the accepted values; these tests fail if the two drift.
const INDEX_HTML_PATH = path.resolve(import.meta.dirname, "../../../../index.html");

function readInlineScript(): string {
  const html = readFileSync(INDEX_HTML_PATH, "utf8");
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  return match?.[1] ?? "";
}

describe("index.html pre-paint theme script", () => {
  it("reads the same storage key the theme module writes", () => {
    const keys = [...readInlineScript().matchAll(/getItem\("([^"]+)"\)/g)].map(
      (match) => match[1],
    );
    expect(keys).toEqual([THEME_STORAGE_KEY]);
  });

  it("accepts only light and dark as stored choices, as the module does", () => {
    const accepted = [
      ...readInlineScript().matchAll(/theme !== "([^"]+)"/g),
    ].map((match) => match[1]);
    expect([...accepted].sort()).toEqual(["dark", "light"]);
    for (const value of accepted) {
      expect(parsePreference(value)).toBe(value);
    }
  });
});
