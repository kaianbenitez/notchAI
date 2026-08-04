import { describe, expect, it } from "vitest";

import { normalizeStatementRow } from "../src/import/statement-parse";

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
