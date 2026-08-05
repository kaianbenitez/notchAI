import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, expect, it } from "vitest";

import { createAccount, createCategory } from "../src/accounts/repo";
import { createGroup } from "../src/groups/repo";
import { createPerson, listRecentFriendActivity } from "../src/people/repo";
import {
  captureOwedExpense,
  captureSettlement,
  captureSplitExpense,
} from "../src/transactions/split-capture";

const SCHEMA = readFileSync(
  fileURLToPath(new URL("../db/schema.sql", import.meta.url)),
  "utf8",
);
const USER = "00000000-0000-0000-0000-000000000001";

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
});

it("lists signed split, owed, settlement, and grouped activity per friend", async () => {
  const cash = await createAccount(db, { userId: USER, name: "Cash", role: "asset", kind: "cash" });
  const dining = await createCategory(db, { userId: USER, name: "Dining" });
  const ana = await createPerson(db, { userId: USER, name: "Ana" });
  const bea = await createPerson(db, { userId: USER, name: "Bea" });
  const group = await createGroup(db, { userId: USER, name: "Beach trip" });

  const splitId = await captureSplitExpense(db, {
    userId: USER, occurredAt: "2026-08-01", payee: "Dinner", amount: "900",
    categoryId: dining.id, accountId: cash.id, groupId: group.id, shareType: "equal",
    participants: [{ personId: ana.id }, { personId: bea.id }],
  });
  const owedId = await captureOwedExpense(db, {
    userId: USER, occurredAt: "2026-08-02", payee: "Taxi", categoryId: dining.id,
    personId: ana.id, yourShareMinor: 12_345,
  });
  const settlementId = await captureSettlement(db, {
    userId: USER, occurredAt: "2026-08-03", cashAccountId: cash.id,
    personId: ana.id, amountMinor: 10_000,
  });

  const activity = await listRecentFriendActivity(db, USER);
  const splitRows = activity.filter((item) => item.transactionId === splitId);
  expect(splitRows).toHaveLength(2);
  expect(splitRows).toEqual(expect.arrayContaining([
    expect.objectContaining({ personId: ana.id, amountMinor: 30_000, groupId: group.id, groupName: "Beach trip", shareType: "equal" }),
    expect.objectContaining({ personId: bea.id, amountMinor: 30_000, groupId: group.id, groupName: "Beach trip", shareType: "equal" }),
  ]));
  expect(activity.find((item) => item.transactionId === owedId)).toMatchObject({ personId: ana.id, amountMinor: -12_345 });
  expect(activity.find((item) => item.transactionId === settlementId)).toMatchObject({ personId: ana.id, amountMinor: -10_000, shareType: null });
});

it("filters one friend and respects the requested activity limit", async () => {
  const cash = await createAccount(db, { userId: USER, name: "Cash", role: "asset", kind: "cash" });
  const dining = await createCategory(db, { userId: USER, name: "Dining" });
  const ana = await createPerson(db, { userId: USER, name: "Ana" });
  const bea = await createPerson(db, { userId: USER, name: "Bea" });

  await captureSplitExpense(db, { userId: USER, occurredAt: "2026-08-01", payee: "Lunch", amount: "100", categoryId: dining.id, accountId: cash.id, shareType: "equal", participants: [{ personId: ana.id }] });
  await captureSplitExpense(db, { userId: USER, occurredAt: "2026-08-02", payee: "Coffee", amount: "100", categoryId: dining.id, accountId: cash.id, shareType: "equal", participants: [{ personId: ana.id }] });
  await captureSplitExpense(db, { userId: USER, occurredAt: "2026-08-03", payee: "Snack", amount: "100", categoryId: dining.id, accountId: cash.id, shareType: "equal", participants: [{ personId: bea.id }] });

  const anaOnly = await listRecentFriendActivity(db, USER, { personId: ana.id });
  expect(anaOnly).toHaveLength(2);
  expect(anaOnly.every((item) => item.personId === ana.id)).toBe(true);
  const limited = await listRecentFriendActivity(db, USER, { limit: 2 });
  expect(limited).toHaveLength(2);
  expect(limited.map((item) => item.payee)).toEqual(["Snack", "Coffee"]);
});
