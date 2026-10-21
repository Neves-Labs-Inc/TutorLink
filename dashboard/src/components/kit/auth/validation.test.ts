import { describe, expect, it } from "vitest";
import {
  PASSWORD_HELP,
  getConfirmError,
  getEmailError,
  getNewPasswordError,
  getSignInPasswordError,
} from "@/components/kit/auth/validation";

describe("getEmailError", () => {
  it("asks for an email when it is empty or only spaces", () => {
    expect(getEmailError("")).toBe("Enter your email address.");
    expect(getEmailError("   ")).toBe("Enter your email address.");
  });

  it("asks for a full address when the shape is wrong", () => {
    const message = "Enter a full email address, like name@example.com.";
    expect(getEmailError("name")).toBe(message);
    expect(getEmailError("name@example")).toBe(message);
    expect(getEmailError("na me@example.com")).toBe(message);
  });

  it("accepts an address, ignoring surrounding spaces", () => {
    expect(getEmailError(" name@example.com ")).toBeUndefined();
  });
});

describe("getSignInPasswordError", () => {
  it("requires a password but applies no length rule", () => {
    expect(getSignInPasswordError("")).toBe("Enter your password.");
    expect(getSignInPasswordError("x")).toBeUndefined();
  });
});

describe("getNewPasswordError", () => {
  it("asks for a password when empty", () => {
    expect(getNewPasswordError("")).toBe("Choose a password.");
  });

  it("rejects under 8 characters and accepts exactly 8", () => {
    expect(getNewPasswordError("1234567")).toBe("Use at least 8 characters.");
    expect(getNewPasswordError("12345678")).toBeUndefined();
  });

  it("accepts exactly 72 bytes and rejects 73", () => {
    expect(getNewPasswordError("a".repeat(72))).toBeUndefined();
    expect(getNewPasswordError("a".repeat(73))).toBe(
      "That password is too long. Try a shorter one.",
    );
  });

  it("counts UTF-8 bytes, not characters, for the upper limit", () => {
    // 36 two-byte characters = 72 bytes; 37 = 74 bytes but only 37 chars.
    expect(getNewPasswordError("é".repeat(36))).toBeUndefined();
    expect(getNewPasswordError("é".repeat(37))).toBe(
      "That password is too long. Try a shorter one.",
    );
    // 19 four-byte emoji = 76 bytes, 38 UTF-16 units.
    expect(getNewPasswordError("😀".repeat(19))).toBe(
      "That password is too long. Try a shorter one.",
    );
  });

  it("counts a short multi-byte password by characters for the lower limit", () => {
    expect(getNewPasswordError("éééééé")).toBe("Use at least 8 characters.");
  });

  it("counts emoji as one character each, as the server does", () => {
    // 4 code points but 8 UTF-16 units: the server refuses it as too short.
    expect(getNewPasswordError("😀😀😀😀")).toBe("Use at least 8 characters.");
    expect(getNewPasswordError("😀".repeat(8))).toBeUndefined();
  });

  it("exposes the help text shown under the field", () => {
    expect(PASSWORD_HELP).toBe("At least 8 characters.");
  });
});

describe("getConfirmError", () => {
  it("asks to type the password again when empty", () => {
    expect(getConfirmError("password1", "")).toBe("Type the password again.");
  });

  it("flags a mismatch with a curly apostrophe", () => {
    expect(getConfirmError("password1", "password2")).toBe(
      "The two passwords don’t match.",
    );
  });

  it("accepts a match", () => {
    expect(getConfirmError("password1", "password1")).toBeUndefined();
  });
});
