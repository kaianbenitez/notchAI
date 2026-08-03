import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { archiveAccount, createAccount, createCategory } from "../src/accounts/repo.js";
import { archiveBudget, createBudget } from "../src/budgets/repo.js";
import { getMonthBudgetProgress } from "../src/budgets/progress.js";
import { postTransaction } from "../src/ledger/post.js";

const SCHEMA = readFileSync(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";

let db: PGlite;
let cashId: string;
let diningId: string;

beforeEach(async () => {
  db = new PGlite(); await db.exec(SCHEMA);
  cashId = (await createAccount(db, { userId: USER, name: "Cash", role: "asset", kind: "cash" })).id;
  diningId = (await createCategory(db, { userId: USER, name: "Dining" })).id;
});

async function spend(month: string, amountMinor: number) {
  await postTransaction(db, { userId: USER, occurredAt: `${month}-10`, payee: "Lunch" }, [
    { accountId: cashId, amountMinor: -amountMinor }, { accountId: diningId, amountMinor },
  ]);
}

describe("budget validation and lifecycle", () => {
  it("rejects invalid categories, amounts, months, and a duplicate active budget", async () => {
    await expect(createBudget(db, { userId: USER, accountId: cashId, amountMinor: 100, startsOn: "2026-01" })).rejects.toThrow(/not an expense category/);
    await db.query("insert into accounts (user_id, name, role, kind) values ($1, 'Odd', 'expense', 'cash')", [USER]);
    const odd = (await db.query<{ id: string }>("select id from accounts where name = 'Odd'")).rows[0];
    await expect(createBudget(db, { userId: USER, accountId: odd.id, amountMinor: 100, startsOn: "2026-01" })).rejects.toThrow(/not an expense category/);
    const archived = await createCategory(db, { userId: USER, name: "Old" }); await archiveAccount(db, USER, archived.id);
    await expect(createBudget(db, { userId: USER, accountId: archived.id, amountMinor: 100, startsOn: "2026-01" })).rejects.toThrow(/archived/);
    await expect(createBudget(db, { userId: USER, accountId: diningId, amountMinor: 0, startsOn: "2026-01" })).rejects.toThrow(/positive/);
    await expect(createBudget(db, { userId: USER, accountId: diningId, amountMinor: 100, startsOn: "2026-13" })).rejects.toThrow(/YYYY-MM/);
    await createBudget(db, { userId: USER, accountId: diningId, amountMinor: 100, startsOn: "2026-01" });
    await expect(createBudget(db, { userId: USER, accountId: diningId, amountMinor: 100, startsOn: "2026-01" })).rejects.toThrow(/already have a budget for "Dining"/);
  });

  it("allows a fresh budget after archiving the old one", async () => {
    const old = await createBudget(db, { userId: USER, accountId: diningId, amountMinor: 100, startsOn: "2026-01" });
    await archiveBudget(db, USER, old.id);
    const fresh = await createBudget(db, { userId: USER, accountId: diningId, amountMinor: 200, startsOn: "2026-02" });
    expect(fresh.id).not.toBe(old.id);
  });
});

describe("budget progress", () => {
  it("keeps a non-rollover budget flat in each month", async () => {
    await createBudget(db, { userId: USER, accountId: diningId, amountMinor: 10_000, startsOn: "2026-01" }); await spend("2026-01", 12_000);
    expect((await getMonthBudgetProgress(db, USER, "2026-01"))[0]).toMatchObject({ budgetedMinor: 10_000, spentMinor: 12_000, remainingMinor: -2_000 });
    expect((await getMonthBudgetProgress(db, USER, "2026-02"))[0]).toMatchObject({ budgetedMinor: 10_000, spentMinor: 0, remainingMinor: 10_000 });
  });

  it("carries underspend into the following month", async () => {
    await createBudget(db, { userId: USER, accountId: diningId, amountMinor: 10_000, rolloverEnabled: true, startsOn: "2026-01" }); await spend("2026-01", 6_000);
    expect((await getMonthBudgetProgress(db, USER, "2026-02"))[0]).toMatchObject({ budgetedMinor: 14_000, spentMinor: 0, remainingMinor: 14_000 });
  });

  it("carries overspending as a deficit and compounds it", async () => {
    await createBudget(db, { userId: USER, accountId: diningId, amountMinor: 10_000, rolloverEnabled: true, startsOn: "2026-01" });
    await spend("2026-01", 12_000); await spend("2026-02", 9_000); await spend("2026-03", 11_000);
    expect((await getMonthBudgetProgress(db, USER, "2026-02"))[0]).toMatchObject({ budgetedMinor: 8_000, spentMinor: 9_000, remainingMinor: -1_000 });
    expect((await getMonthBudgetProgress(db, USER, "2026-03"))[0]).toMatchObject({ budgetedMinor: 9_000, spentMinor: 11_000, remainingMinor: -2_000 });
    expect((await getMonthBudgetProgress(db, USER, "2026-04"))[0]).toMatchObject({ budgetedMinor: 8_000, spentMinor: 0, remainingMinor: 8_000 });
  });

  it("has no carry-in in its starting month, excludes future starts and archived budgets", async () => {
    const budget = await createBudget(db, { userId: USER, accountId: diningId, amountMinor: 10_000, rolloverEnabled: true, startsOn: "2026-03" });
    expect(await getMonthBudgetProgress(db, USER, "2026-02")).toEqual([]);
    expect((await getMonthBudgetProgress(db, USER, "2026-03"))[0]).toMatchObject({ budgetedMinor: 10_000, spentMinor: 0, remainingMinor: 10_000 });
    await archiveBudget(db, USER, budget.id);
    expect(await getMonthBudgetProgress(db, USER, "2026-03")).toEqual([]);
  });
});
