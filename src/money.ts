/**
 * Money in and out of the UI.
 *
 * Every amount in this app is an integer number of centavos. The one dangerous
 * moment is the boundary where a human types "1,234.50" and something has to
 * turn that into 123450. The obvious `Number(text) * 100` is wrong: 19.99 * 100
 * is 1998.9999999999998, and `.toFixed(2)` arithmetic just moves the same
 * problem around. So the text is walked digit by digit and accumulated into an
 * integer — the float is never constructed in the first place.
 */

/** Largest amount we will parse: ~₱90 trillion, well inside a safe integer. */
const MAX_MINOR = Number.MAX_SAFE_INTEGER;

export class AmountParseError extends Error {
  constructor(readonly input: string, reason: string) {
    super(`cannot read "${input}" as an amount: ${reason}`);
    this.name = "AmountParseError";
  }
}

/**
 * Parse human-typed text into integer centavos.
 *
 * Accepts a leading peso sign, thousands separators, and either a minus sign or
 * accounting parentheses for negatives. Rejects anything it cannot read exactly
 * — an amount that is silently wrong is worse than an amount that is refused.
 */
export function parseAmountToMinor(input: string): number {
  const raw = input.trim();
  if (raw === "") throw new AmountParseError(input, "it is empty");

  // Strip the currency marker, then thousands separators and internal spaces.
  let text = raw.replace(/^(₱|php|p)\s*/i, "");

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true; // (1,234.50) is how statements write a credit
    text = text.slice(1, -1).trim();
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }

  // Separators are only meaningful to a reader; drop them before validating.
  text = text.replace(/[,_\s]/g, "");
  if (text === "") throw new AmountParseError(input, "it has no digits");

  const [whole, fraction, ...extra] = text.split(".");
  if (extra.length > 0) {
    throw new AmountParseError(input, "it has more than one decimal point");
  }
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction ?? "")) {
    throw new AmountParseError(input, "it contains characters that are not digits");
  }
  if (whole === "" && (fraction ?? "") === "") {
    throw new AmountParseError(input, "it has no digits");
  }
  if (fraction !== undefined && fraction.length > 2) {
    // Rounding here would invent or destroy a fraction of a centavo without
    // telling anyone. Make the caller decide.
    throw new AmountParseError(
      input,
      `centavos go to two decimal places, got ${fraction.length}`,
    );
  }

  // Digit-wise accumulation. No float is ever created.
  let minor = 0;
  for (const ch of whole) {
    minor = minor * 10 + Number(ch);
    if (minor > MAX_MINOR / 100) {
      throw new AmountParseError(input, "it is too large");
    }
  }
  minor = minor * 100;

  const centavos = (fraction ?? "").padEnd(2, "0");
  minor += Number(centavos[0]) * 10 + Number(centavos[1]);

  if (minor > MAX_MINOR) throw new AmountParseError(input, "it is too large");
  return negative ? -minor : minor;
}

/**
 * Format centavos for display: `123450` → `"1,234.50"`. Always two decimal
 * places, because a budget that shows "1,234.5" reads as an error.
 */
export function formatMinor(minor: number): string {
  if (!Number.isInteger(minor)) {
    throw new Error(`amounts are integer centavos, got ${minor}`);
  }
  const negative = minor < 0;
  const abs = Math.abs(minor);

  const whole = Math.trunc(abs / 100);
  const centavos = abs - whole * 100;

  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${String(centavos).padStart(2, "0")}`;
}

/** Same as {@link formatMinor} with the peso sign, for labels and headings. */
export function formatPeso(minor: number): string {
  const body = formatMinor(minor);
  return body.startsWith("-") ? `-₱${body.slice(1)}` : `₱${body}`;
}
