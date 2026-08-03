import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { archiveAccount, createAccount, createCategory, getAccount } from "../src/accounts/repo";
import { CaptureError, captureTransaction, listRecentTransactions } from "../src/transactions/capture";

const SCHEMA = readFileSync(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
let db: PGlite;

beforeEach(async () => { db = new PGlite(); await db.exec(SCHEMA); });

async function fixtures() {
  const cash = await createAccount(db, { userId: USER, name: "Cash", role: "asset", kind: "cash" });
  const card = await createAccount(db, { userId: USER, name: "Card", role: "liability", kind: "credit_card" });
  const dining = await createCategory(db, { userId: USER, name: "Dining" });
  const salary = await createCategory(db, { userId: USER, name: "Salary", role: "income" });
  return { cash, card, dining, salary };
}

function input(overrides: Partial<Parameters<typeof captureTransaction>[1]> = {}) {
  return { userId: USER, direction: "out" as const, occurredAt: "2026-08-03", payee: "Lunch", amount: "250.50", categoryId: "", accountId: "", ...overrides };
}

async function countRows(table: "transactions" | "entries") {
  const result = await db.query<{ count: string }>(`select count(*) as count from ${table}`);
  return Number(result.rows[0].count);
}

describe("manual capture", () => {
  it("posts money out as two balanced entries and updates balances", async () => {
    const { cash, dining } = await fixtures();
    await captureTransaction(db, input({ accountId: cash.id, categoryId: dining.id }));
    expect(await db.query("select amount_minor from entries order by amount_minor")).toMatchObject({ rows: [{ amount_minor: -25050 }, { amount_minor: 25050 }] });
    expect(await countRows("entries")).toBe(2);
    expect((await getAccount(db, USER, cash.id))!.balanceMinor).toBe(-25050);
    expect((await getAccount(db, USER, dining.id))!.balanceMinor).toBe(25050);
  });

  it("posts money in with mirrored entries and balances", async () => {
    const { cash, salary } = await fixtures();
    await captureTransaction(db, input({ direction: "in", payee: "Employer", amount: "1,000.00", accountId: cash.id, categoryId: salary.id }));
    expect((await getAccount(db, USER, cash.id))!.balanceMinor).toBe(100000);
    expect((await getAccount(db, USER, salary.id))!.balanceMinor).toBe(-100000);
  });

  it("rejects invalid amounts without writing", async () => {
    const { cash, dining } = await fixtures();
    for (const amount of ["wat", "1.234", "0"]) {
      await expect(captureTransaction(db, input({ amount, accountId: cash.id, categoryId: dining.id }))).rejects.toThrow();
      expect(await countRows("transactions")).toBe(0);
      expect(await countRows("entries")).toBe(0);
    }
  });

  it("rejects a mismatched category, category account, archives, and another user's rows", async () => {
    const { cash, dining, salary } = await fixtures();
    await expect(captureTransaction(db, input({ direction: "in", accountId: cash.id, categoryId: dining.id }))).rejects.toThrow(CaptureError);
    await expect(captureTransaction(db, input({ accountId: dining.id, categoryId: dining.id }))).rejects.toThrow(CaptureError);
    await archiveAccount(db, USER, dining.id);
    await expect(captureTransaction(db, input({ accountId: cash.id, categoryId: dining.id }))).rejects.toThrow(/archived/);
    const freshCategory = await createCategory(db, { userId: USER, name: "Fresh" });
    await archiveAccount(db, USER, cash.id);
    await expect(captureTransaction(db, input({ accountId: cash.id, categoryId: freshCategory.id }))).rejects.toThrow(/archived/);
    const otherAccount = await createAccount(db, { userId: OTHER, name: "Other cash", role: "asset", kind: "cash" });
    await expect(captureTransaction(db, input({ accountId: otherAccount.id, categoryId: salary.id }))).rejects.toThrow(/does not exist/);
    expect(await countRows("transactions")).toBe(0);
  });

  it("round-trips a centavo-scale and very large amount exactly", async () => {
    const { cash, card, dining } = await fixtures();
    await captureTransaction(db, input({ amount: "0.05", accountId: cash.id, categoryId: dining.id }));
    await captureTransaction(db, input({ amount: "1,234,567.89", accountId: card.id, categoryId: dining.id }));
    expect((await getAccount(db, USER, cash.id))!.balanceMinor).toBe(-5);
    expect((await getAccount(db, USER, card.id))!.balanceMinor).toBe(-123456789);
    expect((await getAccount(db, USER, dining.id))!.balanceMinor).toBe(123456794);
  });

  it("lists most recent captures newest first", async () => {
    const { cash, dining } = await fixtures();
    await captureTransaction(db, input({ occurredAt: "2026-08-01", payee: "First", accountId: cash.id, categoryId: dining.id }));
    await captureTransaction(db, input({ occurredAt: "2026-08-03", payee: "Last", amount: "50", accountId: cash.id, categoryId: dining.id }));
    const recent = await listRecentTransactions(db, USER);
    expect(recent.map((transaction) => transaction.payee)).toEqual(["Last", "First"]);
    expect(recent[0]).toMatchObject({ category: "Dining", account: "Cash", amountMinor: 5000 });
  });

  it("treats the same client id as an already saved capture", async () => {
    const { cash, dining } = await fixtures();
    const first = await captureTransaction(db, input({ accountId: cash.id, categoryId: dining.id, clientId: "client-attempt-1" }));
    const second = await captureTransaction(db, input({ accountId: cash.id, categoryId: dining.id, clientId: "client-attempt-1" }));
    expect(second).toBe(first);
    expect(await countRows("transactions")).toBe(1);
    expect(await countRows("entries")).toBe(2);
  });

  it("accepts separate client ids as separate captures", async () => {
    const { cash, dining } = await fixtures();
    await captureTransaction(db, input({ accountId: cash.id, categoryId: dining.id, clientId: "client-attempt-1" }));
    await captureTransaction(db, input({ accountId: cash.id, categoryId: dining.id, clientId: "client-attempt-2" }));
    expect(await countRows("transactions")).toBe(2);
  });

  it("still accepts a capture without a client id", async () => {
    const { cash, dining } = await fixtures();
    await captureTransaction(db, input({ accountId: cash.id, categoryId: dining.id }));
    expect(await countRows("transactions")).toBe(1);
  });
});
