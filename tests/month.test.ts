import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { createAccount, createCategory } from "../src/accounts/repo";
import { captureTransaction } from "../src/transactions/capture";
import { getMonthSummary, listMonthCategoryTotals, listMonthTransactions } from "../src/transactions/month";

const SCHEMA = readFileSync(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";

let db: PGlite;
let cashId: string;
let diningId: string;
let groceriesId: string;
let salaryId: string;

async function capture(overrides: Partial<Parameters<typeof captureTransaction>[1]> = {}) {
  return captureTransaction(db, {
    userId: USER,
    direction: "out",
    occurredAt: "2026-07-01",
    payee: "Corner shop",
    amount: "10.00",
    accountId: cashId,
    categoryId: diningId,
    ...overrides,
  });
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  cashId = (await createAccount(db, { userId: USER, name: "Cash", role: "asset", kind: "cash" })).id;
  diningId = (await createCategory(db, { userId: USER, name: "Dining" })).id;
  groceriesId = (await createCategory(db, { userId: USER, name: "Groceries" })).id;
  salaryId = (await createCategory(db, { userId: USER, name: "Salary", role: "income" })).id;
});

describe("month actuals", () => {
  it("uses plain month boundaries, excluding the prior month's last day", async () => {
    await capture({ occurredAt: "2026-06-30", payee: "June" });
    await capture({ occurredAt: "2026-07-01", payee: "July" });

    expect((await listMonthTransactions(db, USER, "2026-07")).map((transaction) => transaction.payee)).toEqual(["July"]);
    expect(await getMonthSummary(db, USER, "2026-07")).toMatchObject({ expenseMinor: 1_000 });
  });

  it("aggregates multiple transactions in each active category", async () => {
    await capture({ amount: "10.00", categoryId: diningId });
    await capture({ amount: "2.50", categoryId: diningId });
    await capture({ amount: "5.00", categoryId: groceriesId });

    expect(await listMonthCategoryTotals(db, USER, "2026-07")).toEqual([
      { name: "Dining", role: "expense", amountMinor: 1_250 },
      { name: "Groceries", role: "expense", amountMinor: 500 },
    ]);
  });

  it("reports income and expenses separately and computes their net", async () => {
    await capture({ amount: "125.25", categoryId: diningId });
    await capture({ direction: "in", payee: "Employer", amount: "1,000.00", categoryId: salaryId });

    expect(await getMonthSummary(db, USER, "2026-07")).toEqual({
      incomeMinor: 100_000,
      expenseMinor: 12_525,
      netMinor: 87_475,
    });
  });

  it("excludes merged duplicates from totals and the transaction list", async () => {
    const duplicate = await capture({ payee: "Merged duplicate", amount: "99.00" });
    await capture({ payee: "Kept", amount: "10.00" });
    await db.query("update transactions set status = 'duplicate_merged' where id = $1", [duplicate]);

    expect(await getMonthSummary(db, USER, "2026-07")).toMatchObject({ expenseMinor: 1_000 });
    expect((await listMonthTransactions(db, USER, "2026-07")).map((transaction) => transaction.payee)).toEqual(["Kept"]);
  });

  it("never returns another user's transactions or aggregates", async () => {
    await capture({ payee: "Mine", amount: "10.00" });
    const otherCash = await createAccount(db, { userId: OTHER, name: "Other cash", role: "asset", kind: "cash" });
    const otherDining = await createCategory(db, { userId: OTHER, name: "Other dining" });
    await captureTransaction(db, {
      userId: OTHER,
      direction: "out",
      occurredAt: "2026-07-01",
      payee: "Theirs",
      amount: "500.00",
      accountId: otherCash.id,
      categoryId: otherDining.id,
    });

    expect(await getMonthSummary(db, USER, "2026-07")).toMatchObject({ expenseMinor: 1_000 });
    expect((await listMonthTransactions(db, USER, "2026-07")).map((transaction) => transaction.payee)).toEqual(["Mine"]);
  });
});
