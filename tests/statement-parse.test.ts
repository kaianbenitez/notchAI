import { describe, expect, it } from "vitest";

import { coerceStatementRows, normalizeStatementRow } from "../src/import/statement-parse";

const cleanRow = {
  occurredAt: "2026-07-31", payee: "  Jollibee  ", amountText: "340.50", kind: "charge", categoryGuess: "Dining", confidence: 0.82,
};

describe("normalizeStatementRow", () => {
  it("normalizes a clean model row into integer centavos", () => {
    expect(normalizeStatementRow(cleanRow)).toEqual({
      occurredAt: "2026-07-31", payee: "Jollibee", amountText: "340.50", amountMinor: 34050,
      kind: "charge", categoryGuess: "Dining", confidence: 0.82,
    });
  });

  it("drops an unparseable amount", () => {
    expect(normalizeStatementRow({ ...cleanRow, amountText: "three hundred" })).toBeNull();
  });

  it("drops a missing date", () => {
    expect(normalizeStatementRow({ ...cleanRow, occurredAt: null })).toBeNull();
  });

  it("drops an unrecognized kind", () => {
    expect(normalizeStatementRow({ ...cleanRow, kind: "transfer" })).toBeNull();
  });
});

describe("coerceStatementRows", () => {
  it("preserves a well-formed model response", () => {
    expect(coerceStatementRows([cleanRow])).toEqual([cleanRow]);
  });

  it("returns an empty list for an empty response", () => {
    expect(coerceStatementRows([])).toEqual([]);
  });

  it("fills missing fields and rejects wrong field types without coercion", () => {
    expect(coerceStatementRows([
      {},
      { occurredAt: "2026-07-31", payee: "Cafe", amountText: 340.5, kind: "unexpected", categoryGuess: 42, confidence: "0.8" },
    ])).toEqual([
      { occurredAt: null, payee: null, amountText: null, kind: null, categoryGuess: null, confidence: 0 },
      { occurredAt: "2026-07-31", payee: "Cafe", amountText: null, kind: "unexpected", categoryGuess: null, confidence: 0 },
    ]);
  });

  it("rejects a non-array top-level value", () => {
    expect(() => coerceStatementRows({ rows: [] })).toThrow("not an array");
  });
});
