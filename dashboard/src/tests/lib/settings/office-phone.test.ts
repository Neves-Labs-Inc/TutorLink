import { describe, expect, it } from "vitest";
import { formatPhoneInput, toE164 } from "@/lib/settings/office-phone";

describe("formatPhoneInput", () => {
  it.each([
    ["+", "+"],
    ["+1", "+1"],
    ["+13", "+1 (3"],
    ["+1305", "+1 (305"],
    ["+13055", "+1 (305) 5"],
    ["+1305555", "+1 (305) 555"],
    ["+13055550", "+1 (305) 555-0"],
    ["+13055550142", "+1 (305) 555-0142"],
    ["+1 (305) 555-0142", "+1 (305) 555-0142"],
  ])("formats %j as %j while typing", (typed, shown) => {
    expect(formatPhoneInput(typed, typed.length).text).toBe(shown);
  });

  it("leaves other country codes as typed", () => {
    expect(formatPhoneInput("+52 55 1234 5678", 3).text).toBe("+52 55 1234 5678");
  });

  it("leaves a number without a + as typed, so the error can say why", () => {
    expect(formatPhoneInput("305 555", 7).text).toBe("305 555");
  });

  it("drops a separator left dangling by a backspace", () => {
    // Backspacing the 5 in "+1 (305) 5" leaves "+1 (305) ".
    expect(formatPhoneInput("+1 (305) ", 9).text).toBe("+1 (305");
  });

  it("keeps the caret after the same digit when separators are added", () => {
    // Typed the 5 at the end of "+1 (305": caret after it.
    const result = formatPhoneInput("+1 (3055", 8);
    expect(result.text).toBe("+1 (305) 5");
    expect(result.caret).toBe(10);
  });

  it("never moves the caret backwards on an edit in the middle", () => {
    // Typed a 9 after "+1 (3" in "+1 (305) 555-0142".
    const result = formatPhoneInput("+1 (3905) 555-0142", 6);
    expect(result.text).toBe("+1 (390) 555-50142");
    expect(result.caret).toBe(6);
  });
});

describe("toE164", () => {
  it("strips spaces, brackets, dots and dashes", () => {
    expect(toE164("+1 (305) 555-0142")).toBe("+13055550142");
    expect(toE164("+52 55.1234.5678")).toBe("+525512345678");
  });

  it("round-trips a stored number through the shown form", () => {
    const shown = formatPhoneInput("+13055550142", 0).text;
    expect(toE164(shown)).toBe("+13055550142");
  });
});
