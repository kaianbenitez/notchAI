import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { archiveAccount, createAccount, createCategory, getAccount } from "../src/accounts/repo";
import { captureTransaction } from "../src/transactions/capture";
import { EditError, getEditableTransaction, updateTransaction } from "../src/transactions/edit";

const SCHEMA = readFileSync(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";
let db: PGlite;

beforeEach(async () => { db = new PGlite(); await db.exec(SCHEMA); });

async function fixtures() {
  const cash = await createAccount(db, { userId: USER, name: "Cash", role: "asset", kind: "cash" });
  const card = await createAccount(db, { userId: USER, name: "Card", role: "liability", kind: "credit_card" });
  const dining = await createCategory(db, { userId: USER, name: "Dining" });
  const transport = await createCategory(db, { userId: USER, name: "Transport" });
  const salary = await createCategory(db, { userId: USER, name: "Salary", role: "income" });
  return { cash, card, dining, transport, salary };
}

describe("editing a captured transaction", () => {
  it("changes date, payee, memo, category, and account without touching the amount", async () => {
    const { cash, card, dining, transport } = await fixtures();
    const id = await captureTransaction(db, {
      userId: USER, direction: "out", occurredAt: "2026-08-03", payee: "Lunch", amount: "250.50",
      categoryId: dining.id, accountId: cash.id,
    });

    await updateTransaction(db, USER, id, {
      occurredAt: "2026-08-04", payee: "Taxi", categoryId: transport.id, accountId: card.id, memo: "correction",
    });

    const edited = await getEditableTransaction(db, USER, id);
    expect(edited).toMatchObject({
      occurredAt: "2026-08-04", payee: "Taxi", memo: "correction",
      categoryId: transport.id, accountId: card.id, amountMinor: 25050,
    });
    expect((await getAccount(db, USER, cash.id))!.balanceMinor).toBe(0);
    expect((await getAccount(db, USER, card.id))!.balanceMinor).toBe(-25050);
    expect((await getAccount(db, USER, dining.id))!.balanceMinor).toBe(0);
    expect((await getAccount(db, USER, transport.id))!.balanceMinor).toBe(25050);
  });

  it("rejects a category of the wrong role, an archived account, and someone else's transaction", async () => {
    const { cash, dining, salary } = await fixtures();
    const id = await captureTransaction(db, {
      userId: USER, direction: "out", occurredAt: "2026-08-03", payee: "Lunch", amount: "100",
      categoryId: dining.id, accountId: cash.id,
    });

    await expect(updateTransaction(db, USER, id, {
      occurredAt: "2026-08-03", payee: "Lunch", categoryId: salary.id, accountId: cash.id,
    })).rejects.toThrow(EditError);

    await archiveAccount(db, USER, dining.id);
    const freshCategory = await createCategory(db, { userId: USER, name: "Fresh" });
    await expect(updateTransaction(db, USER, id, {
      occurredAt: "2026-08-03", payee: "Lunch", categoryId: dining.id, accountId: cash.id,
    })).rejects.toThrow(/archived/);

    await expect(updateTransaction(db, USER, id, {
      occurredAt: "2026-08-03", payee: "Lunch", categoryId: freshCategory.id, accountId: cash.id,
    })).resolves.toBeUndefined();

    await expect(getEditableTransaction(db, "00000000-0000-0000-0000-000000000002", id)).rejects.toThrow(EditError);
  });
});
