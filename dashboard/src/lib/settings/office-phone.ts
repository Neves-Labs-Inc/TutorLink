// The office phone as people type it: +1 numbers take the US shape
// ("+1 (305) 555-0142") as the digits arrive; the stored form is E.164.
// Separators only appear once a digit follows them, so a backspace never
// gets stuck on a bracket or dash.

export type PhoneInput = { text: string; caret: number };

const NANP_PREFIX = "+1";
const AREA_DIGITS = 3;
const EXCHANGE_DIGITS = 3;
const SEPARATORS = /[\s().-]/g;
const SIGNIFICANT = /[\d+]/;

// Spaces, brackets, dots and dashes are fine to type; the API stores E.164.
export function toE164(typed: string): string {
  return typed.replace(SEPARATORS, "");
}

function formatNanp(digits: string): string {
  const area = digits.slice(0, AREA_DIGITS);
  const exchange = digits.slice(AREA_DIGITS, AREA_DIGITS + EXCHANGE_DIGITS);
  const line = digits.slice(AREA_DIGITS + EXCHANGE_DIGITS);

  let text = NANP_PREFIX;
  if (area) text += ` (${area}`;
  if (exchange) text += `) ${exchange}`;
  if (line) text += `-${line}`;
  return text;
}

// Where the caret lands: after as many digits (and +) as it had before.
function findCaret(text: string, significantCount: number): number {
  let seen = 0;
  let caret = 0;
  while (caret < text.length && seen < significantCount) {
    if (SIGNIFICANT.test(text[caret])) seen += 1;
    caret += 1;
  }
  return caret;
}

export function formatPhoneInput(typed: string, caret: number): PhoneInput {
  const compact = toE164(typed);
  if (!compact.startsWith(NANP_PREFIX)) return { text: typed, caret };

  const digits = compact.slice(NANP_PREFIX.length).replace(/\D/g, "");
  const text = formatNanp(digits);
  const significantBefore = [...typed.slice(0, caret)].filter((char) =>
    SIGNIFICANT.test(char),
  ).length;
  return { text, caret: findCaret(text, significantBefore) };
}
