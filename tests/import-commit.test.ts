import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

import { createAccount, createCategory } from "../src/accounts/repo";
import { commitMatchedStatement, commitNewStatement } from "../src/import/commit";
import { postTransaction } from "../src/ledger/post";

const SCHEMA = readFileSync(fileURLToPath(new URL("../db/schema.sql", import.meta.url)), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";
const INGEST_EVENT = "00000000-0000-0000-0000-000000000010";
let db: PGlite;

beforeEach(async () => { db = new PGlite(); await db.exec(SCHEMA); });

async function fixtures() {
  const card = await createAccount(db, { userId: USER, name: "Card", role: "liability", kind: "credit_card" });
  const dining = await createCategory(db, { userId: USER, name: "Dining" });
  await db.query(
    `insert into ingest_events (id, user_id, kind, account_id, raw_payload)
     values ($1, $2, 'statement', $3, $4)`,
    [INGEST_EVENT, USER, card.id, "synthetic statement row"],
  );
  return { card, dining };
}

const row = { occurredAt: "2026-08-10", payee: "Coffee Bean", memo: "Posted", amountMinor: 10_500, currency: "PHP" };

async function transactionCount() {
  return Number((await db.query<{ count: string }>("select count(*) as count from transactions")).rows[0].count);
}

describe("statement commit", () => {
  it("replaces a matched transaction atomically and links the statement ingest event", async () => {
    const { card, dining } = await fixtures();
    const oldId = await postTransaction(db, { userId: USER, occurredAt: "2026-08-08", payee: "Coffee Bean" }, [
      { accountId: card.id, amountMinor: -10_000 }, { accountId: dining.id, amountMinor: 10_000 },
    ]);

    const newId = await commitMatchedStatement(db, { userId: USER, oldTransactionId: oldId, ingestEventId: INGEST_EVENT, accountId: card.id, categoryId: dining.id, statementRow: row });
    expect(await db.query("select id from transactions where id = $1", [oldId])).toMatchObject({ rows: [] });
    expect(await db.query("select amount_minor from entries where transaction_id = $1 order by amount_minor", [newId])).toMatchObject({ rows: [{ amount_minor: -10500 }, { amount_minor: 10500 }] });
    expect(await db.query("select source, status, ingest_event_id from transactions where id = $1", [newId])).toMatchObject({ rows: [{ source: "statement", status: "confirmed", ingest_event_id: INGEST_EVENT }] });
  });

  it("posts a new statement transaction without deleting anything", async () => {
    const { card, dining } = await fixtures();
    const id = await commitNewStatement(db, { userId: USER, ingestEventId: INGEST_EVENT, accountId: card.id, categoryId: dining.id, statementRow: row });
    expect(await transactionCount()).toBe(1);
    expect(await db.query("select source, status, dedupe_hash from transactions where id = $1", [id])).toMatchObject({ rows: [{ source: "statement", status: "confirmed", dedupe_hash: expect.any(String) }] });
  });

  it("rolls back the deletion when replacement posting fails", async () => {
    const { card, dining } = await fixtures();
    const oldId = await postTransaction(db, { userId: USER, occurredAt: "2026-08-08", payee: "Coffee Bean" }, [
      { accountId: card.id, amountMinor: -10_000 }, { accountId: dining.id, amountMinor: 10_000 },
    ]);

    await expect(commitMatchedStatement(db, { userId: USER, oldTransactionId: oldId, ingestEventId: INGEST_EVENT, accountId: card.id, categoryId: "00000000-0000-0000-0000-000000000099", statementRow: row })).rejects.toThrow();
    expect(await db.query("select id from transactions where id = $1", [oldId])).toMatchObject({ rows: [{ id: oldId }] });
    expect(await transactionCount()).toBe(1);
  });
});
