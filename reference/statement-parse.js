// Statement / CSV parsing, harvested from cc-tracker app.js @ 0542fd1.
// De-DOM'd: the original read form fields and pushed straight into global state. Here the
// parsers are pure and the import step returns rows instead of mutating.
//
// Feeds PLAN.md §6.1 Layer 1 (monthly statement) and Layer 2 (weekly unbilled screenshot).
// This is a first pass and a fixture source — NOT the Layer 1 design, which is
// qpdf → text → LLM → dual-pass verify. Amounts below are floats; convert to integer
// centavos at the boundary and never let a float into the ledger.

// --- Dates ---------------------------------------------------------------------------

/** ISO and numeric forms. Falls through to `new Date()`, which is locale-dependent — the
 *  one line worth replacing rather than porting. */
export function normalizeDate(value) {
  if (!value) return null;
  const clean = String(value).trim();

  const iso = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  // NOTE: MM/DD/YY assumed, not DD/MM. BPI statements are US-order; verify per source.
  const parts = clean.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (parts) {
    const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
    return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }

  const parsed = new Date(clean);
  return Number.isNaN(parsed.getTime())
    ? null
    : `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

/**
 * Adds named months ("Jun 9", "June 9, 2026") and year inference.
 *
 * The year-inference problem is the real content here: statement rows often carry no year,
 * so it is taken from the statement date the user selected. That breaks on a December
 * statement containing January rows — a cycle spanning a year boundary infers the wrong
 * year for part of its rows. Handle that explicitly in the new importer.
 */
export function normalizeStatementTextDate(rawDate, fallbackYear) {
  const clean = String(rawDate || "").replace(/,/g, "").trim();
  const monthNames = {
    jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
    may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
    oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
  };

  const named = clean.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:\s+(\d{2,4}))?$/);
  if (named) {
    const month = monthNames[named[1].toLowerCase()];
    if (!month) return null;
    const year = named[3]
      ? (named[3].length === 2 ? Number(`20${named[3]}`) : Number(named[3]))
      : fallbackYear;
    return `${year}-${String(month).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
  }

  const numeric = clean.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (numeric) {
    const year = numeric[3]
      ? (numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : String(fallbackYear);
    return `${year}-${numeric[1].padStart(2, "0")}-${numeric[2].padStart(2, "0")}`;
  }

  return normalizeDate(clean);
}

// --- Pasted statement text -----------------------------------------------------------

/**
 * Pasted statement text → [[date, description, amountString], ...]
 *
 * The heuristic: a transaction line starts with a date and ends with money; whatever sits
 * between them is the merchant. Taking the LAST money match is deliberate — statement rows
 * often carry a foreign-currency original before the peso amount, and the peso figure is
 * the one that posts.
 *
 * Known limits, all of which PLAN.md §6.1 already anticipates:
 *   - A row wrapping onto two lines loses its tail. Bank PDFs wrap constantly.
 *   - A line needs BOTH a leading date and a money value, so anything else is dropped
 *     silently — no "unparsed lines" report. Add one; silent loss is the failure mode
 *     that matters here.
 *   - Requires cents (`\d\.\d{2}`), so a whole-peso row without decimals is skipped.
 *   - BPI's unbilled view has no merchant at all, so `description` will be the category.
 *     That is expected — those rows become stubs keyed on (amount, date ±3d, account).
 */
export function parseStatementText(text, fallbackYear = new Date().getFullYear()) {
  const moneyPattern = /(?:[-+]?\s?(?:[A-Z]{0,3}\$?|[^\d\s(.-]{1,3})?\s?\(?\d[\d,]*\.\d{2}\)?)/g;

  return text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const dateMatch = line.match(
        /^((?:\d{4}[-/]\d{1,2}[-/]\d{1,2})|(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)|(?:[A-Za-z]{3,9}\s+\d{1,2}(?:,?\s+\d{2,4})?))\s+/
      );
      const amounts = [...line.matchAll(moneyPattern)];
      if (!dateMatch || !amounts.length) return null;

      const amountMatch = amounts[amounts.length - 1];
      const date = normalizeStatementTextDate(dateMatch[1], fallbackYear);
      const description = line.slice(dateMatch[0].length, amountMatch.index).trim().replace(/\s{2,}/g, " ");
      if (!date || !description) return null;

      return [date, description, amountMatch[0]];
    })
    .filter(Boolean);
}

// --- CSV -----------------------------------------------------------------------------

/** RFC-4180-ish: handles quoted fields, escaped quotes, CRLF. Drops all-empty rows. */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/**
 * Header sniffing + column mapping. PLAN.md §6 wants a saved per-bank mapping UI; this
 * auto-detects instead, which is the right default for the first import of an unknown file.
 * Keep the detection as the pre-fill, then let the user correct it and save the result.
 */
export function detectColumns(rows) {
  const first = rows[0].map(cell => String(cell).trim().toLowerCase());
  const hasHeader = first.some(cell => /date|description|merchant|amount|debit|transaction/.test(cell));

  let amountIndex = hasHeader
    ? first.findIndex(cell => /amount|debit|charge/.test(cell))
    : Math.max(2, rows[0].length - 1);
  if (amountIndex < 0) amountIndex = rows[0].length - 1;

  return {
    hasHeader,
    dateIndex: hasHeader ? first.findIndex(cell => /date|posted/.test(cell)) : 0,
    descriptionIndex: hasHeader ? first.findIndex(cell => /description|merchant|details|payee|name/.test(cell)) : 1,
    amountIndex,
    categoryIndex: hasHeader ? first.findIndex(cell => /category/.test(cell)) : -1
  };
}

/**
 * Amount string → number. Strips currency symbols and separators; `(1,234.00)` is negative,
 * which is how statements print credits and refunds.
 *
 * PORT AS: string → integer centavos, parsed digit-wise. Do not go through Number().
 * Note the original stripped a mojibaked peso sign (the file was written non-UTF-8 aware) —
 * strip the real `₱` and be encoding-explicit on file read.
 */
export function parseAmount(raw) {
  const normalized = String(raw || "").replace(/[,₱$\s]/g, "");
  const isParenthesized = /^\(.*\)$/.test(normalized);
  let amount = Number(normalized.replace(/[()]/g, "").replace(/[^\d.-]/g, ""));
  if (isParenthesized) amount = -Math.abs(amount);
  return Number.isFinite(amount) ? amount : null;
}

/**
 * Rows → transaction drafts. The original pushed these straight into state with NO DEDUPE —
 * re-importing a statement silently doubled it. PLAN.md §6 dedupe must run before insert.
 *
 * `statementLocked` marks a row as coming from an actual statement. It is the flag
 * `repairStatementAssignments` should honour and does not (see statement-cycle.js).
 */
export function rowsToDrafts(rows, { cardId, importType, statementEnd, inferStatementEnd, card }) {
  const cols = detectColumns(rows);
  const data = cols.hasHeader ? rows.slice(1) : rows;

  return data.map(row => {
    const date = normalizeDate(row[cols.dateIndex]);
    const amount = parseAmount(row[cols.amountIndex]);
    if (!date || amount === null || amount === 0) return null;

    // Prefer the date-inferred cycle over the one the user picked, so a statement
    // containing stragglers from the previous cycle files them correctly.
    let resolvedStatementEnd = null;
    if (importType === "statement") {
      const inferred = inferStatementEnd(card, date);
      resolvedStatementEnd = !statementEnd ? inferred : (card?.statementDay ? (inferred || statementEnd) : statementEnd);
    }

    return {
      date,
      description: row[cols.descriptionIndex] || "Imported transaction",
      category: cols.categoryIndex >= 0 && row[cols.categoryIndex] ? row[cols.categoryIndex] : guessCategory(row[cols.descriptionIndex] || ""),
      amount,
      cardId,
      statementEnd: resolvedStatementEnd,
      statementLocked: importType === "statement"
    };
  }).filter(Boolean);
}

// --- Category guessing ---------------------------------------------------------------

/**
 * Substring rules over the merchant string. Superseded by PLAN.md §5 category learning
 * (`merchant_normalized → category`, remembered after one correction) — but keep this as
 * the cold-start default for a merchant seen for the first time, before any LLM call.
 * Cheaper and more predictable than a model for the obvious cases.
 */
export function guessCategory(description) {
  const value = String(description).toLowerCase();
  if (/restaurant|cafe|coffee|grill|pizza|food|starbucks/.test(value)) return "Dining";
  if (/market|grocery|foods|supermarket/.test(value)) return "Groceries";
  if (/uber|grab|shell|gas|fuel|transit/.test(value)) return "Transport";
  if (/spotify|netflix|apple\.com|subscription/.test(value)) return "Subscriptions";
  if (/ikea|hardware|home/.test(value)) return "Home";
  if (/airline|hotel|airbnb|booking/.test(value)) return "Travel";
  if (/store|shop|uniqlo|amazon/.test(value)) return "Shopping";
  return "Other";
}
