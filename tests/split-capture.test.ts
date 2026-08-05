import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, expect, it } from "vitest";
import {
  createAccount,
  createCategory,
  getAccount,
} from "../src/accounts/repo";
import { createPerson } from "../src/people/repo";
import { createGroup } from "../src/groups/repo";
import {
  captureOwedExpense,
  captureSettlement,
  captureSplitExpense,
} from "../src/transactions/split-capture";
const S = readFileSync(
    fileURLToPath(new URL("../db/schema.sql", import.meta.url)),
    "utf8",
  ),
  U = "00000000-0000-0000-0000-000000000001";
let db: PGlite;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(S);
});
it("posts dinner metadata and settlement exactly", async () => {
  const cash = await createAccount(db, {
      userId: U,
      name: "Cash",
      role: "asset",
      kind: "cash",
    }),
    cat = await createCategory(db, { userId: U, name: "Dining" }),
    ana = await createPerson(db, { userId: U, name: "Ana" }),
    g = await createGroup(db, { userId: U, name: "Trip" });
  const id = await captureSplitExpense(db, {
    userId: U,
    occurredAt: "2026-08-01",
    payee: "Dinner",
    amount: "1000",
    categoryId: cat.id,
    accountId: cash.id,
    groupId: g.id,
    shareType: "equal",
    participants: [{ personId: ana.id }],
  });
  expect((await getAccount(db, U, ana.receivableAccountId))!.balanceMinor).toBe(
    50000,
  );
  expect(
    (
      await db.query(
        "select share_minor, share_type from splits where transaction_id=$1",
        [id],
      )
    ).rows[0],
  ).toMatchObject({ share_minor: 50000, share_type: "equal" });
  expect(
    (await db.query("select id from transactions where group_id=$1", [g.id]))
      .rows,
  ).toHaveLength(1);
  await captureSettlement(db, {
    userId: U,
    occurredAt: "2026-08-02",
    cashAccountId: cash.id,
    personId: ana.id,
    amountMinor: 50000,
  });
  expect((await getAccount(db, U, ana.receivableAccountId))!.balanceMinor).toBe(
    0,
  );
});
it("records owed expenses without cash and rejects oversized shares", async () => {
  const cash = await createAccount(db, {
      userId: U,
      name: "Cash",
      role: "asset",
      kind: "cash",
    }),
    cat = await createCategory(db, { userId: U, name: "Dining" }),
    ana = await createPerson(db, { userId: U, name: "Ana" });
  await captureOwedExpense(db, {
    userId: U,
    occurredAt: "2026-08-01",
    payee: "Dinner",
    categoryId: cat.id,
    personId: ana.id,
    yourShareMinor: 123,
  });
  expect((await getAccount(db, U, ana.receivableAccountId))!.balanceMinor).toBe(
    -123,
  );
  expect((await getAccount(db, U, cash.id))!.balanceMinor).toBe(0);
  await expect(
    captureSplitExpense(db, {
      userId: U,
      occurredAt: "2026-08-01",
      payee: "x",
      amount: "1",
      categoryId: cat.id,
      accountId: cash.id,
      shareType: "exact",
      participants: [{ personId: ana.id, weight: 200 }],
    }),
  ).rejects.toThrow(/exceed/);
});

it("keeps an indivisible three-way split exact and categories only your remainder", async () => {
  const cash = await createAccount(db, {
    userId: U,
    name: "Cash",
    role: "asset",
    kind: "cash",
  });
  const category = await createCategory(db, { userId: U, name: "Dining" });
  const ana = await createPerson(db, { userId: U, name: "Ana" });
  const bea = await createPerson(db, { userId: U, name: "Bea" });
  const transactionId = await captureSplitExpense(db, {
    userId: U,
    occurredAt: "2026-08-01",
    payee: "Dinner",
    amount: "1000",
    categoryId: category.id,
    accountId: cash.id,
    shareType: "equal",
    participants: [{ personId: ana.id }, { personId: bea.id }],
  });
  const { rows } = await db.query<{ share_minor: number }>(
    "select share_minor from splits where transaction_id = $1 order by share_minor desc",
    [transactionId],
  );
  const others = rows.reduce((sum, row) => sum + Number(row.share_minor), 0);
  const spend = await db.query<{ spent_minor: number }>(
    "select spent_minor from category_spend where category_id = $1",
    [category.id],
  );
  const yours = Number(spend.rows[0].spent_minor);
  expect(others + yours).toBe(100000);
  expect(yours).toBe(33334);
});

it("rejects zero settlements, invalid share types, and foreign participants", async () => {
  const cash = await createAccount(db, {
    userId: U,
    name: "Cash",
    role: "asset",
    kind: "cash",
  });
  const category = await createCategory(db, { userId: U, name: "Dining" });
  const ana = await createPerson(db, { userId: U, name: "Ana" });
  const foreign = await createPerson(db, {
    userId: "00000000-0000-0000-0000-000000000002",
    name: "Bea",
  });
  await expect(
    captureSettlement(db, {
      userId: U,
      occurredAt: "2026-08-01",
      cashAccountId: cash.id,
      personId: ana.id,
      amountMinor: 0,
    }),
  ).rejects.toThrow(/nonzero/);
  await expect(
    captureSplitExpense(db, {
      userId: U,
      occurredAt: "2026-08-01",
      payee: "Dinner",
      amount: "10",
      categoryId: category.id,
      accountId: cash.id,
      shareType: "bad" as never,
      participants: [{ personId: ana.id }],
    }),
  ).rejects.toThrow(/valid share type/);
  await expect(
    captureSplitExpense(db, {
      userId: U,
      occurredAt: "2026-08-01",
      payee: "Dinner",
      amount: "10",
      categoryId: category.id,
      accountId: cash.id,
      shareType: "equal",
      participants: [{ personId: foreign.id }],
    }),
  ).rejects.toThrow(/person/);
});
