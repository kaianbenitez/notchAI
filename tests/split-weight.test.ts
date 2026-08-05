import { expect, it } from "vitest";

import { parseSplitWeight } from "../src/app/split/weight";

it("parses finite positive percentage and share weights without money conversion", () => {
  expect(parseSplitWeight("60")).toBe(60);
  expect(parseSplitWeight("1.5")).toBe(1.5);
});

it.each(["", "   ", "not a number", "Infinity", "-1", "0"])(
  "rejects an invalid split weight: %j",
  (value) => {
    expect(() => parseSplitWeight(value)).toThrow(
      "each participant needs a positive numeric weight",
    );
  },
);
