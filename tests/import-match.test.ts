import { describe, expect, it } from "vitest";

import { assignMatches, classifyMatch, dedupeHash, matchScore, reducedKey } from "../src/import/match";

const statement = {
  normalizedMerchant: "Coffee Bean",
  amountMinor: 10_500,
  currency: "PHP",
  occurredAt: "2026-08-10",
  accountId: "account-a",
};

describe("statement matching", () => {
  it("uses the normalized hash as an exact auto-match", () => {
    const hash = dedupeHash("  Coffee   Bean ", 10_500, "PHP", "2026-08-10");
    expect(hash).toBe(dedupeHash("coffee bean", 10_500, "PHP", "2026-08-10"));
    expect(matchScore({ ...statement, dedupeHash: hash }, { ...statement, dedupeHash: hash })).toBe(1);
  });

  it("scores amount differences inside but not outside the five-percent boundary", () => {
    expect(matchScore(statement, { ...statement, amountMinor: 10_000, occurredAt: "2026-07-01", normalizedMerchant: "Other", accountId: "other" })).toBe(0.5);
    expect(matchScore(statement, { ...statement, amountMinor: 9_999, occurredAt: "2026-07-01", normalizedMerchant: "Other", accountId: "other" })).toBe(0);
  });

  it("scores dates at but not beyond the seven-day boundary", () => {
    expect(matchScore(statement, { ...statement, occurredAt: "2026-08-17", normalizedMerchant: "Other", accountId: "other", amountMinor: 1 })).toBe(0.2);
    expect(matchScore(statement, { ...statement, occurredAt: "2026-08-18", normalizedMerchant: "Other", accountId: "other", amountMinor: 1 })).toBe(0);
  });

  it("uses a merchant similarity threshold of 0.8", () => {
    expect(matchScore(statement, { ...statement, normalizedMerchant: "Coffee Been", occurredAt: "2026-07-01", amountMinor: 1, accountId: "other" })).toBe(0.2);
    expect(matchScore(statement, { ...statement, normalizedMerchant: "Coffee Shop", occurredAt: "2026-07-01", amountMinor: 1, accountId: "other" })).toBe(0);
  });

  it("classifies the 0.5 and 0.8 boundaries", () => {
    expect(classifyMatch(0.49)).toBe("none");
    expect(classifyMatch(0.5)).toBe("suggested");
    expect(classifyMatch(0.79)).toBe("suggested");
    expect(classifyMatch(0.8)).toBe("auto");
  });

  it("keeps an amount, date, and account match at the auto threshold despite float rounding", () => {
    const score = matchScore(
      { ...statement, normalizedMerchant: "JOLLIBEE SM NORTH" },
      { ...statement, normalizedMerchant: "Jollibee" },
    );
    expect(score).toBeCloseTo(0.8);
    expect(classifyMatch(score)).toBe("auto");
  });

  it("adds the same-account score and produces the merchantless reduced key", () => {
    expect(matchScore(statement, { ...statement, normalizedMerchant: "Other", occurredAt: "2026-07-01", amountMinor: 1 })).toBe(0.1);
    expect(reducedKey(10_500, "2026-08-10", "account-a")).toBe("10500|2026-08-10|account-a");
  });

  it("assigns identical statement rows to distinct identical logged transactions", () => {
    const hash = dedupeHash("Coffee Bean", 10_500, "PHP", "2026-08-10");
    const rows = [{ ...statement, dedupeHash: hash }, { ...statement, dedupeHash: hash }];
    const candidates = [
      { ...statement, id: "first", dedupeHash: hash },
      { ...statement, id: "second", dedupeHash: hash },
    ];

    expect(assignMatches(rows, candidates)).toEqual([
      { candidate: candidates[0], score: 1 },
      { candidate: candidates[1], score: 1 },
    ]);
  });
});
