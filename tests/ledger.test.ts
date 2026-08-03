import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { postTransaction, UnbalancedTransactionError } from "../src/ledger/post.js";
import {
  buildOwedExpense,
  buildSettlement,
  buildSplitExpense,
  simplifyDebts,
  splitByWeights,
  splitEqual,
} from "../src/ledger/split.js";

const SCHEMA = readFileSync(
  fileURLToPath(new URL("../db/schema.sql", import.meta.url)),
  "utf8",
);

const USER = "00000000-0000-0000-0000-000000000001";

let db: PGlite;
let card: string, gcash: string, dining: string, ana: string;

async function account(
  name: string,
  role: string,
  kind: string,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into accounts (user_id, name, role, kind) values ($1,$2,$3,$4) returning id`,
    [USER, name, role, kind],
  );
  return rows[0].id;
}

async function balance(accountId: string): Promise<number> {
  const { rows } = await db.query<{ balance_minor: number }>(
    `select balance_minor from account_balances where account_id = $1`,
    [accountId],
  );
  return Number(rows[0].balance_minor);
}

async function spend(categoryId: string): Promise<number> {
  const { rows } = await db.query<{ total: number }>(
    `select coalesce(sum(spent_minor), 0) as total
       from category_spend where category_id = $1`,
    [categoryId],
  );
  return Number(rows[0].total);
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  card = await account("BPI Credit Card", "liability", "credit_card");
  gcash = await account("GCash", "asset", "ewallet");
  dining = await account("Dining", "expense", "category");
  ana = await account("Receivable: Ana", "asset", "receivable");
});

describe("the balance invariant", () => {
  it("accepts a balanced transaction", async () => {
    const id = await postTransaction(db, { userId: USER, occurredAt: "2026-08-01" }, [
      { accountId: card, amountMinor: -50_000 },
      { accountId: dining, amountMinor: 50_000 },
    ]);
    expect(id).toBeTruthy();
    expect(await balance(dining)).toBe(50_000);
  });

  it("rejects entries that do not sum to zero, before touching the database", async () => {
    await expect(
      postTransaction(db, { userId: USER, occurredAt: "2026-08-01" }, [
        { accountId: card, amountMinor: -50_000 },
        { accountId: dining, amountMinor: 49_900 },
      ]),
    ).rejects.toThrow(UnbalancedTransactionError);

    const { rows } = await db.query(`select count(*)::int as n from transactions`);
    expect((rows[0] as any).n).toBe(0);
  });

  it("rejects a single-entry transaction", async () => {
    await expect(
      postTransaction(db, { userId: USER, occurredAt: "2026-08-01" }, [
        { accountId: card, amountMinor: -50_000 },
      ]),
    ).rejects.toThrow(/at least two entries/);
  });

  // The database must refuse unbalanced writes even if application code is
  // bypassed. This is the guarantee everything else is built on.
  it("the trigger blocks an unbalanced write made behind the API's back", async () => {
    await db.exec("begin");
    const { rows } = await db.query<{ id: string }>(
      `insert into transactions (user_id, occurred_at) values ($1,$2) returning id`,
      [USER, "2026-08-01"],
    );
    const txn = rows[0].id;
    await db.query(
      `insert into entries (transaction_id, account_id, amount_minor, base_amount_minor)
       values ($1,$2,$3,$3)`,
      [txn, card, -50_000],
    );
    await db.query(
      `insert into entries (transaction_id, account_id, amount_minor, base_amount_minor)
       values ($1,$2,$3,$3)`,
      [txn, dining, 40_000],
    );
    await expect(db.exec("commit")).rejects.toThrow(/does not balance/);
  });

  it("allows entries to be inserted one at a time within a transaction", async () => {
    // Proves the constraint is deferred, not immediate.
    await db.exec("begin");
    const { rows } = await db.query<{ id: string }>(
      `insert into transactions (user_id, occurred_at) values ($1,$2) returning id`,
      [USER, "2026-08-01"],
    );
    const txn = rows[0].id;
    await db.query(
      `insert into entries (transaction_id, account_id, amount_minor, base_amount_minor)
       values ($1,$2,$3,$3)`,
      [txn, card, -50_000],
    );
    await db.query(
      `insert into entries (transaction_id, account_id, amount_minor, base_amount_minor)
       values ($1,$2,$3,$3)`,
      [txn, dining, 50_000],
    );
    await expect(db.exec("commit")).resolves.toBeDefined();
  });
});

describe("the ₱1,000 dinner, split 50/50 with Ana", () => {
  beforeEach(async () => {
    await postTransaction(
      db,
      { userId: USER, occurredAt: "2026-08-01", payee: "Manam" },
      buildSplitExpense({
        paidFromAccountId: card,
        categoryAccountId: dining,
        totalMinor: 100_000,
        shares: [{ personAccountId: ana, shareMinor: 50_000 }],
      }),
    );
  });

  // The bug that motivated this whole design: the old app forced a manual "/2".
  it("charges the budget your share only, not the full bill", async () => {
    expect(await spend(dining)).toBe(50_000);
  });

  it("records the full amount against the card", async () => {
    expect(await balance(card)).toBe(-100_000);
    const { rows } = await db.query<{ display_balance_minor: number }>(
      `select display_balance_minor from account_balances where account_id = $1`,
      [card],
    );
    // A liability reads positive when you owe on it.
    expect(Number(rows[0].display_balance_minor)).toBe(100_000);
  });

  it("shows Ana owing you her half", async () => {
    expect(await balance(ana)).toBe(50_000);
  });

  it("zeroes Ana out when she settles up, without touching the budget", async () => {
    await postTransaction(
      db,
      { userId: USER, occurredAt: "2026-08-03", memo: "Ana settled" },
      buildSettlement({ cashAccountId: gcash, personAccountId: ana, amountMinor: 50_000 }),
    );
    expect(await balance(ana)).toBe(0);
    expect(await balance(gcash)).toBe(50_000);
    expect(await spend(dining)).toBe(50_000); // unchanged
  });
});

describe("when someone else paid", () => {
  it("records your share as a debt, touching none of your accounts", async () => {
    const owedToAna = await account("Payable: Ana", "liability", "payable");
    await postTransaction(
      db,
      { userId: USER, occurredAt: "2026-08-02" },
      buildOwedExpense({
        categoryAccountId: dining,
        personAccountId: owedToAna,
        yourShareMinor: 40_000,
      }),
    );
    expect(await spend(dining)).toBe(40_000);
    expect(await balance(owedToAna)).toBe(-40_000);
    expect(await balance(card)).toBe(0);
    expect(await balance(gcash)).toBe(0);
  });
});

describe("split arithmetic never loses a centavo", () => {
  it("splits ₱1,000 three ways exactly", () => {
    const parts = splitEqual(100_000, 3);
    expect(parts).toEqual([33_334, 33_333, 33_333]);
    expect(parts.reduce((a, b) => a + b)).toBe(100_000);
  });

  it("holds for every division of an awkward amount", () => {
    for (let ways = 1; ways <= 17; ways++) {
      expect(splitEqual(99_991, ways).reduce((a, b) => a + b)).toBe(99_991);
    }
  });

  it("distributes weighted shares exactly", () => {
    const parts = splitByWeights(100_000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b)).toBe(100_000);
    expect(splitByWeights(10_000, [70, 30])).toEqual([7_000, 3_000]);
  });

  it("keeps a split transaction balanced at an indivisible amount", async () => {
    const bea = await account("Receivable: Bea", "asset", "receivable");

    // ₱100.01 three ways does not divide: [3334, 3334, 3333].
    const [yourShare, anaShare, beaShare] = splitEqual(10_001, 3);
    expect(yourShare + anaShare + beaShare).toBe(10_001);

    await expect(
      postTransaction(
        db,
        { userId: USER, occurredAt: "2026-08-04" },
        buildSplitExpense({
          paidFromAccountId: card,
          categoryAccountId: dining,
          totalMinor: 10_001,
          shares: [
            { personAccountId: ana, shareMinor: anaShare },
            { personAccountId: bea, shareMinor: beaShare },
          ],
        }),
      ),
    ).resolves.toBeTruthy();

    // buildSplitExpense derives your share as the remainder, so it agrees with
    // splitEqual and the entries still balance.
    expect(await spend(dining)).toBe(yourShare);
    expect(await balance(ana)).toBe(anaShare);
    expect(await balance(bea)).toBe(beaShare);
    expect(await balance(card)).toBe(-10_001);
  });
});

describe("foreign currency", () => {
  it("balances in PHP, not in the native currency", async () => {
    const ibkr = await account("IBKR", "asset", "brokerage");
    const fees = await account("Investment Fees", "expense", "category");
    // $10 at ₱58.50
    await postTransaction(db, { userId: USER, occurredAt: "2026-08-05" }, [
      { accountId: ibkr, amountMinor: -1_000, currency: "USD", fxRateToBase: 58.5 },
      { accountId: fees, amountMinor: 58_500 },
    ]);
    expect(await balance(ibkr)).toBe(-58_500);
    expect(await spend(fees)).toBe(58_500);
  });

  it("refuses a foreign entry with no rate", async () => {
    await expect(
      postTransaction(db, { userId: USER, occurredAt: "2026-08-05" }, [
        { accountId: card, amountMinor: -1_000, currency: "USD" },
        { accountId: dining, amountMinor: 58_500 },
      ]),
    ).rejects.toThrow(/needs an fxRateToBase/);
  });
});

describe("simplifyDebts", () => {
  it("settles a three-way tangle in two transfers", () => {
    const transfers = simplifyDebts([
      { personId: "you", balanceMinor: 60_000 },
      { personId: "ana", balanceMinor: -40_000 },
      { personId: "bea", balanceMinor: -20_000 },
    ]);
    expect(transfers).toHaveLength(2);
    expect(transfers.reduce((s, t) => s + t.amountMinor, 0)).toBe(60_000);
    expect(transfers.every((t) => t.toPersonId === "you")).toBe(true);
  });

  it("refuses balances that do not net to zero", () => {
    expect(() =>
      simplifyDebts([
        { personId: "you", balanceMinor: 60_000 },
        { personId: "ana", balanceMinor: -10_000 },
      ]),
    ).toThrow(/net to zero/);
  });
});
