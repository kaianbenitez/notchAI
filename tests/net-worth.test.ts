import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import {
  archiveNetWorthLabel,
  createSavingsGoal,
  getSavingsGoalProgress,
  listCurrentBalances,
  recordNetWorthSnapshot,
} from "../src/net-worth/repo";

const SCHEMA = readFileSync(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
});

describe("manual net worth", () => {
  it("records snapshots, reusing labels without regard to case", async () => {
    const first = await recordNetWorthSnapshot(db, {
      userId: USER, labelName: "Maya HYSA", category: "cash", balanceMinor: 125_050, asOf: "2026-08-01",
    });
    const second = await recordNetWorthSnapshot(db, {
      userId: USER, labelName: "maya hysa", category: "investment", balanceMinor: 130_000, asOf: "2026-08-02",
    });

    expect(second.labelId).toBe(first.labelId);
    expect((await db.query<{ count: string }>("select count(*)::text as count from net_worth_labels")).rows[0].count).toBe("1");
    expect((await listCurrentBalances(db, USER))).toEqual([expect.objectContaining({ label: "Maya HYSA", category: "cash", balanceMinor: 130_000, asOf: "2026-08-02" })]);
  });

  it("returns only each label's latest snapshot and excludes archived labels", async () => {
    const maya = await recordNetWorthSnapshot(db, {
      userId: USER, labelName: "Maya", category: "cash", balanceMinor: 10_000, asOf: "2026-08-01",
    });
    await recordNetWorthSnapshot(db, { userId: USER, labelId: maya.labelId, balanceMinor: 20_000, asOf: "2026-08-03" });
    await recordNetWorthSnapshot(db, {
      userId: USER, labelName: "Car", category: "vehicle", balanceMinor: 900_000, asOf: "2026-08-02",
    });

    expect(await listCurrentBalances(db, USER)).toEqual([
      expect.objectContaining({ label: "Maya", balanceMinor: 20_000, asOf: "2026-08-03" }),
      expect.objectContaining({ label: "Car", balanceMinor: 900_000 }),
    ]);
    await archiveNetWorthLabel(db, USER, maya.labelId);
    expect(await listCurrentBalances(db, USER)).toEqual([expect.objectContaining({ label: "Car" })]);
  });

  it("computes goal progress from the latest linked snapshot, including zero and an overshot target", async () => {
    const empty = await recordNetWorthSnapshot(db, {
      userId: USER, labelName: "Emergency", category: "cash", balanceMinor: 0, asOf: "2026-08-01",
    });
    const invested = await recordNetWorthSnapshot(db, {
      userId: USER, labelName: "Property fund", category: "investment", balanceMinor: 150_000, asOf: "2026-08-01",
    });
    await recordNetWorthSnapshot(db, { userId: USER, labelId: invested.labelId, balanceMinor: 250_000, asOf: "2026-08-03" });
    await createSavingsGoal(db, { userId: USER, name: "Emergency fund", targetMinor: 100_000, linkedLabelId: empty.labelId });
    await createSavingsGoal(db, { userId: USER, name: "Property goal", targetMinor: 200_000, linkedLabelId: invested.labelId });
    await createSavingsGoal(db, { userId: USER, name: "Unlinked", targetMinor: 100_000 });

    expect(await getSavingsGoalProgress(db, USER)).toEqual([
      expect.objectContaining({ name: "Emergency fund", currentMinor: 0, progressPercent: 0 }),
      expect.objectContaining({ name: "Property goal", currentMinor: 250_000, progressPercent: 125 }),
      expect.objectContaining({ name: "Unlinked", currentMinor: 0, progressPercent: 0 }),
    ]);
  });

  it("enforces nonnegative balances and positive savings targets", async () => {
    const label = await recordNetWorthSnapshot(db, {
      userId: USER, labelName: "Cash", category: "cash", balanceMinor: 0, asOf: "2026-08-01",
    });
    await expect(recordNetWorthSnapshot(db, {
      userId: USER, labelId: label.labelId, balanceMinor: -1, asOf: "2026-08-02",
    })).rejects.toThrow(/zero or a positive/);
    await expect(createSavingsGoal(db, { userId: USER, name: "Invalid", targetMinor: 0 })).rejects.toThrow(/positive/);
    await expect(db.query("insert into net_worth_snapshots (label_id, balance_minor, as_of) values ($1, -1, '2026-08-02')", [label.labelId])).rejects.toThrow();
    await expect(db.query("insert into savings_goals (user_id, name, target_minor) values ($1, 'Bad', 0)", [USER])).rejects.toThrow();
  });
});
