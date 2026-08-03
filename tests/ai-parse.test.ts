import { describe, expect, it } from "vitest";

import { buildCaptureDraft, matchCategory } from "../src/capture/ai-parse.js";

const categories = [
  { id: "dining", name: "Dining" },
  { id: "groceries", name: "Groceries" },
];

describe("matchCategory", () => {
  it("prefers exact, case-insensitive matches", () => {
    expect(matchCategory("  dining  ", categories)).toEqual(categories[0]);
  });

  it("matches a category name contained in either direction", () => {
    expect(matchCategory("dining out", categories)).toEqual(categories[0]);
    expect(matchCategory("grocer", categories)).toEqual(categories[1]);
  });

  it("returns null when no category can be matched", () => {
    expect(matchCategory("Transport", categories)).toBeNull();
  });
});

describe("buildCaptureDraft", () => {
  it("turns a complete model guess into a ready capture draft", () => {
    expect(buildCaptureDraft({ payee: " Jollibee ", amountText: "340.00", occurredAt: "2026-08-04", categoryGuess: "dining", confidence: 0.8 }, categories, "2026-08-05")).toEqual({
      payee: "Jollibee", amount: "340.00", occurredAt: "2026-08-04", categoryId: "dining", confidence: 0.8,
    });
  });

  it("leaves an invalid amount blank and defaults a missing date to today", () => {
    expect(buildCaptureDraft({ payee: null, amountText: "three hundred", occurredAt: null, categoryGuess: "Groceries", confidence: 0.8 }, categories, "2026-08-05")).toMatchObject({
      payee: "", amount: "", occurredAt: "2026-08-05", categoryId: "groceries",
    });
  });

  it("leaves unmatched categories blank and clamps confidence", () => {
    const above = buildCaptureDraft({ payee: "Shop", amountText: "1", occurredAt: "2026-08-04", categoryGuess: "Transport", confidence: 2 }, categories, "2026-08-05");
    const below = buildCaptureDraft({ payee: "Shop", amountText: "1", occurredAt: "2026-08-04", categoryGuess: null, confidence: -1 }, categories, "2026-08-05");
    expect(above).toMatchObject({ categoryId: "", confidence: 1 });
    expect(below).toMatchObject({ categoryId: "", confidence: 0 });
  });

  it("keeps a matched category blank when the model is not confident enough", () => {
    expect(buildCaptureDraft({ payee: "Shop", amountText: "1", occurredAt: "2026-08-04", categoryGuess: "Dining", confidence: 0.69 }, categories, "2026-08-05")).toMatchObject({ categoryId: "" });
  });
});
