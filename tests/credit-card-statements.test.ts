import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAccount, createCategory } from "../src/accounts/repo";
import { runCreditCardStatementReminders } from "../src/credit-cards/cron";
import { createCreditCardStatement, listCreditCardActivity, payCreditCardStatement, saveCreditCardCutoff } from "../src/credit-cards/repo";
import { postTransaction } from "../src/ledger/post";

const SCHEMA = readFileSync(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";
let db: PGlite; let cardId: string; let bankId: string; let diningId: string; let receivableId: string;

beforeEach(async () => {
  db = new PGlite(); await db.exec(SCHEMA);
  cardId = (await createAccount(db, { userId: USER, name: "Rewards Card", role: "liability", kind: "credit_card" })).id;
  bankId = (await createAccount(db, { userId: USER, name: "Bank", role: "asset", kind: "bank" })).id;
  diningId = (await createCategory(db, { userId: USER, name: "Dining" })).id;
  receivableId = (await createAccount(db, { userId: USER, name: "Alex owes", role: "asset", kind: "receivable" })).id;
});

describe("credit-card statements", () => {
  it("keeps a shared charge whole on the card while reporting only the personal expense", async () => {
    await postTransaction(db, { userId: USER, occurredAt: "2026-08-10", payee: "Dinner", source: "manual", status: "confirmed" }, [
      { accountId: cardId, amountMinor: -100_000 }, { accountId: diningId, amountMinor: 50_000 }, { accountId: receivableId, amountMinor: 50_000 },
    ]);
    await saveCreditCardCutoff(db, USER, cardId, 10);
    const statement = await createCreditCardStatement(db, { userId: USER, accountId: cardId, today: "2026-08-11", amount: "1000", dueOn: "2026-08-15" });
    const activity = await listCreditCardActivity(db, USER, cardId, statement.periodStartsOn, statement.periodEndsOn);
    expect(activity).toMatchObject([{ payee: "Dinner", chargedMinor: 100_000, creditMinor: 0, personalExpenseMinor: 50_000 }]);
  });

  it("pays the official statement balance as a balanced transfer and closes reminders", async () => {
    await postTransaction(db, { userId: USER, occurredAt: "2026-08-10", payee: "Dinner", source: "manual", status: "confirmed" }, [
      { accountId: cardId, amountMinor: -100_000 }, { accountId: diningId, amountMinor: 100_000 },
    ]);
    await saveCreditCardCutoff(db, USER, cardId, 10);
    const statement = await createCreditCardStatement(db, { userId: USER, accountId: cardId, today: "2026-08-11", amount: "1000", dueOn: "2026-08-15" });
    const send = vi.fn(async () => undefined);
    await runCreditCardStatementReminders(db, "2026-08-10", send);
    await runCreditCardStatementReminders(db, "2026-08-10", send);
    expect(send).toHaveBeenCalledTimes(1);
    await payCreditCardStatement(db, { userId: USER, statementId: statement.id, fundingAccountId: bankId, paidOn: "2026-08-10" });
    expect((await db.query("select status from credit_card_statements where id = $1", [statement.id])).rows).toMatchObject([{ status: "paid" }]);
    expect((await db.query("select display_balance_minor from account_balances where account_id = $1", [cardId])).rows).toMatchObject([{ display_balance_minor: 0 }]);
    await runCreditCardStatementReminders(db, "2026-08-11", send);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
