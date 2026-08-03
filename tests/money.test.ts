import { describe, expect, it } from "vitest";

import { AmountParseError, formatMinor, formatPeso, parseAmountToMinor } from "../src/money.js";

describe("parsing what a person types", () => {
  it("reads plain amounts as centavos", () => {
    expect(parseAmountToMinor("1234.56")).toBe(123456);
    expect(parseAmountToMinor("0.05")).toBe(5);
    expect(parseAmountToMinor("100")).toBe(10000);
  });

  it("accepts the peso sign, separators and stray spaces", () => {
    expect(parseAmountToMinor("₱1,234.50")).toBe(123450);
    expect(parseAmountToMinor("  PHP 2 500 ")).toBe(250000);
    expect(parseAmountToMinor("1_000")).toBe(100000);
  });

  it("pads a single decimal place", () => {
    expect(parseAmountToMinor("1.5")).toBe(150);
    expect(parseAmountToMinor(".5")).toBe(50);
    expect(parseAmountToMinor("7.")).toBe(700);
  });

  it("reads negatives, written either way", () => {
    expect(parseAmountToMinor("-250.75")).toBe(-25075);
    expect(parseAmountToMinor("(250.75)")).toBe(-25075);
    expect(parseAmountToMinor("₱-40")).toBe(-4000);
  });

  it("never goes through a float", () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754. Walk the whole awkward set.
    for (let pesos = 0; pesos < 200; pesos++) {
      for (const cents of ["01", "05", "07", "29", "49", "99"]) {
        const text = `${pesos}.${cents}`;
        expect(parseAmountToMinor(text)).toBe(pesos * 100 + Number(cents));
      }
    }
  });

  it("refuses what it cannot read exactly", () => {
    expect(() => parseAmountToMinor("")).toThrow(AmountParseError);
    expect(() => parseAmountToMinor("abc")).toThrow(AmountParseError);
    expect(() => parseAmountToMinor("1.2.3")).toThrow(AmountParseError);
    expect(() => parseAmountToMinor("1e3")).toThrow(AmountParseError);
    expect(() => parseAmountToMinor("12 pesos")).toThrow(AmountParseError);
    expect(() => parseAmountToMinor("₱")).toThrow(AmountParseError);
  });

  it("refuses a third decimal place rather than rounding it away", () => {
    expect(() => parseAmountToMinor("1.005")).toThrow(/two decimal places/);
  });

  it("refuses amounts too large to stay exact", () => {
    expect(() => parseAmountToMinor("999999999999999999")).toThrow(/too large/);
  });
});

describe("formatting for display", () => {
  it("always shows two decimal places", () => {
    expect(formatMinor(123450)).toBe("1,234.50");
    expect(formatMinor(5)).toBe("0.05");
    expect(formatMinor(0)).toBe("0.00");
    expect(formatMinor(100000000)).toBe("1,000,000.00");
  });

  it("puts the sign before the peso sign", () => {
    expect(formatPeso(123450)).toBe("₱1,234.50");
    expect(formatPeso(-25075)).toBe("-₱250.75");
  });

  it("round-trips anything it formats", () => {
    for (const minor of [0, 1, 99, 100, 12345, -12345, 987654321]) {
      expect(parseAmountToMinor(formatMinor(minor))).toBe(minor);
    }
  });

  it("refuses a non-integer, which would mean a float got in", () => {
    expect(() => formatMinor(12.5)).toThrow(/integer centavos/);
  });
});
