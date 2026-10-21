// Client checks that mirror the API's password rules, so most mistakes
// never reach it: 8 characters minimum, 72 bytes maximum (bcrypt's limit).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_CHARS = 8;
const MAX_PASSWORD_BYTES = 72;

export const PASSWORD_HELP = "At least 8 characters.";

export function getEmailError(email: string): string | undefined {
  const trimmed = email.trim();
  let error: string | undefined;
  if (!trimmed) {
    error = "Enter your email address.";
  } else if (!EMAIL_PATTERN.test(trimmed)) {
    error = "Enter a full email address, like name@example.com.";
  }
  return error;
}

export function getSignInPasswordError(password: string): string | undefined {
  return password ? undefined : "Enter your password.";
}

export function getNewPasswordError(password: string): string | undefined {
  const byteCount = new TextEncoder().encode(password).length;
  let error: string | undefined;
  if (!password) {
    error = "Choose a password.";
  } else if ([...password].length < MIN_PASSWORD_CHARS) {
    // Code points, as the server's len() counts them: an emoji is one character.
    error = "Use at least 8 characters.";
  } else if (byteCount > MAX_PASSWORD_BYTES) {
    error = "That password is too long. Try a shorter one.";
  }
  return error;
}

export function getConfirmError(
  password: string,
  confirm: string,
): string | undefined {
  let error: string | undefined;
  if (!confirm) {
    error = "Type the password again.";
  } else if (confirm !== password) {
    error = "The two passwords don’t match.";
  }
  return error;
}
